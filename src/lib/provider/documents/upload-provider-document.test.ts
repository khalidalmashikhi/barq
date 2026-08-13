import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { requireProviderMock, ForbiddenError, UnauthenticatedError } = vi.hoisted(() => ({
  requireProviderMock: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));

const findUniqueMock = vi.fn();
const createMock = vi.fn();
const auditCreateMock = vi.fn();
const requirementFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    providerDocument: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    providerVerificationRequirement: { findMany: (...a: unknown[]) => requirementFindManyMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        providerDocument: { create: (...a: unknown[]) => createMock(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));

const uploadMock = vi.fn();
const removeMock = vi.fn();
const configuredMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: () => configuredMock(),
  uploadPrivateObject: (...a: unknown[]) => uploadMock(...a),
  removePrivateObject: (...a: unknown[]) => removeMock(...a),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { uploadProviderDocument } = await import("./upload-provider-document");

function pdfBytes(size = 64): ArrayBuffer {
  const u = new Uint8Array(size);
  u.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0); // %PDF-
  return u.buffer;
}
const baseInput = () => ({
  type: "COMMERCIAL_REGISTRATION",
  originalFilename: "cr.pdf",
  declaredMimeType: "application/pdf",
  bytes: pdfBytes(),
});

beforeEach(() => {
  requireProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
  configuredMock.mockReturnValue(true);
  findUniqueMock.mockResolvedValue(null);
  uploadMock.mockResolvedValue(undefined);
  removeMock.mockResolvedValue(undefined);
  createMock.mockResolvedValue({ id: "doc-1" });
  auditCreateMock.mockResolvedValue({});
  // Default: an empty (unseeded) policy — registry keys still upload (fail-safe).
  requirementFindManyMock.mockResolvedValue([]);
});
afterEach(() => vi.clearAllMocks());

describe("uploadProviderDocument", () => {
  it("uploads a valid document to the private bucket, creates a PENDING row, and audits", async () => {
    const result = await uploadProviderDocument(baseInput());
    expect(result).toEqual({ ok: true, documentId: "doc-1" });

    // magic-byte validation passed → upload happened, with a private key.
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const uploadArg = uploadMock.mock.calls[0]![0] as { objectKey: string; contentType: string };
    expect(uploadArg.objectKey).toMatch(/^provider-documents\/prov-1\/commercial_registration\/[0-9a-f-]+\.pdf$/);
    expect(uploadArg.contentType).toBe("application/pdf");

    const createArg = createMock.mock.calls[0]![0] as { data: { status: string; providerId: string; type: string; objectKey: string } };
    expect(createArg.data).toMatchObject({ status: "PENDING", providerId: "prov-1", type: "COMMERCIAL_REGISTRATION" });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider.document_uploaded", actorType: "PROVIDER" } });
  });

  it("rejects an arbitrary/unknown type before any upload", async () => {
    const result = await uploadProviderDocument({ ...baseInput(), type: "PASSPORT" });
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("accepts an ACTIVE configured custom key (ADR-0017)", async () => {
    requirementFindManyMock.mockResolvedValue([{ key: "VAT_CERTIFICATE", active: true }]);
    const result = await uploadProviderDocument({ ...baseInput(), type: "VAT_CERTIFICATE" });
    expect(result).toEqual({ ok: true, documentId: "doc-1" });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const createArg = createMock.mock.calls[0]![0] as { data: { type: string } };
    expect(createArg.data.type).toBe("VAT_CERTIFICATE"); // stored as the stable key, unmutated
  });

  it("rejects an INACTIVE configured custom key before any upload", async () => {
    requirementFindManyMock.mockResolvedValue([{ key: "VAT_CERTIFICATE", active: false }]);
    const result = await uploadProviderDocument({ ...baseInput(), type: "VAT_CERTIFICATE" });
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("still accepts a historical registry key even when the policy does not list it (compatibility)", async () => {
    // Policy only lists a custom key; IDENTITY_PROOF is a registry key → still valid.
    requirementFindManyMock.mockResolvedValue([{ key: "VAT_CERTIFICATE", active: true }]);
    const result = await uploadProviderDocument({ ...baseInput(), type: "IDENTITY_PROOF" });
    expect(result).toEqual({ ok: true, documentId: "doc-1" });
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsupported MIME before any upload", async () => {
    const result = await uploadProviderDocument({ ...baseInput(), declaredMimeType: "image/svg+xml" });
    expect(result).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rejects HTML bytes declared as PDF (magic-byte mismatch) before any upload", async () => {
    const html = new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43]); // <!DOC
    const result = await uploadProviderDocument({ ...baseInput(), bytes: html.buffer });
    expect(result).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("declines when document storage is not configured (never falls back to public bucket)", async () => {
    configuredMock.mockReturnValue(false);
    const result = await uploadProviderDocument(baseInput());
    expect(result).toEqual({ ok: false, error: "STORAGE_NOT_CONFIGURED" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("returns ALREADY_EXISTS when a document of this type already exists (use replace)", async () => {
    findUniqueMock.mockResolvedValue({ id: "existing" });
    const result = await uploadProviderDocument(baseInput());
    expect(result).toEqual({ ok: false, error: "ALREADY_EXISTS" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("cleans up the uploaded object if the DB write fails (no orphan)", async () => {
    createMock.mockRejectedValue(new Error("db down"));
    const result = await uploadProviderDocument(baseInput());
    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(removeMock).toHaveBeenCalledTimes(1); // orphan cleanup
  });

  it("maps a non-provider caller to NO_PROVIDER_PROFILE", async () => {
    requireProviderMock.mockRejectedValue(new ForbiddenError());
    const result = await uploadProviderDocument(baseInput());
    expect(result).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });
  });
});
