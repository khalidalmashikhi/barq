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
const updateManyMock = vi.fn();
const auditCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    providerDocument: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        providerDocument: { updateMany: (...a: unknown[]) => updateManyMock(...a) },
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

const { replaceProviderDocument } = await import("./replace-provider-document");
const { documentVersionToken } = await import("./document-version-token");

const OLD_KEY = "provider-documents/prov-1/commercial_registration/old.pdf";
function pdf(): ArrayBuffer {
  const u = new Uint8Array(64);
  u.set([0x25, 0x50, 0x44, 0x46, 0x2d], 0);
  return u.buffer;
}
function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "doc-1",
    expectedVersionToken: documentVersionToken(OLD_KEY),
    originalFilename: "new.pdf",
    declaredMimeType: "application/pdf",
    bytes: pdf(),
    ...overrides,
  };
}
const approvedDoc = { id: "doc-1", providerId: "prov-1", objectKey: OLD_KEY, type: "COMMERCIAL_REGISTRATION", status: "APPROVED" };

beforeEach(() => {
  requireProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
  configuredMock.mockReturnValue(true);
  findUniqueMock.mockResolvedValue({ ...approvedDoc });
  uploadMock.mockResolvedValue(undefined);
  removeMock.mockResolvedValue(undefined);
  updateManyMock.mockResolvedValue({ count: 1 });
  auditCreateMock.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe("replaceProviderDocument", () => {
  it("replaces an APPROVED document with a new object, resets to PENDING, clears review fields, audits, then deletes the old object", async () => {
    const result = await replaceProviderDocument(baseInput());
    expect(result).toEqual({ ok: true });

    // new object uploaded first, under a NEW key (not the old one)
    const newKey = (uploadMock.mock.calls[0]![0] as { objectKey: string }).objectKey;
    expect(newKey).not.toBe(OLD_KEY);
    expect(newKey).toMatch(/^provider-documents\/prov-1\/commercial_registration\/[0-9a-f-]+\.pdf$/);

    // conditional swap bound to the OLD key; resets to PENDING + clears review metadata
    const upd = updateManyMock.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(upd.where).toEqual({ id: "doc-1", objectKey: OLD_KEY });
    expect(upd.data).toMatchObject({ objectKey: newKey, status: "PENDING", rejectionReason: null, reviewedAt: null, reviewedByAdminId: null });

    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider.document_replaced", actorType: "PROVIDER" } });
    // old object removed AFTER commit (best-effort)
    expect(removeMock).toHaveBeenCalledWith(OLD_KEY);
  });

  it("returns STALE_DOCUMENT when the version token no longer matches (concurrent replacement) — no upload", async () => {
    const result = await replaceProviderDocument(baseInput({ expectedVersionToken: "stale-token" }));
    expect(result).toEqual({ ok: false, error: "STALE_DOCUMENT" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("returns STALE_DOCUMENT and cleans up the NEW object when the conditional swap matches 0 rows (race after token check)", async () => {
    updateManyMock.mockResolvedValue({ count: 0 });
    const result = await replaceProviderDocument(baseInput());
    expect(result).toEqual({ ok: false, error: "STALE_DOCUMENT" });
    const newKey = (uploadMock.mock.calls[0]![0] as { objectKey: string }).objectKey;
    expect(removeMock).toHaveBeenCalledWith(newKey); // new object cleaned up
    expect(removeMock).not.toHaveBeenCalledWith(OLD_KEY); // old NOT removed (swap didn't happen)
  });

  it("returns DOCUMENT_NOT_FOUND for another provider's document (uniform, no leak)", async () => {
    findUniqueMock.mockResolvedValue({ ...approvedDoc, providerId: "prov-2" });
    const result = await replaceProviderDocument(baseInput());
    expect(result).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("returns DOCUMENT_NOT_FOUND when the document does not exist", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await replaceProviderDocument(baseInput())).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
  });

  it("rejects an invalid new file (magic-byte mismatch) before upload", async () => {
    const html = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]); // <html
    const result = await replaceProviderDocument(baseInput({ bytes: html.buffer }));
    expect(result).toEqual({ ok: false, error: "SIGNATURE_MISMATCH" });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("cleans up the new object and returns UNKNOWN_ERROR if the DB swap throws", async () => {
    updateManyMock.mockRejectedValue(new Error("db down"));
    const result = await replaceProviderDocument(baseInput());
    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    const newKey = (uploadMock.mock.calls[0]![0] as { objectKey: string }).objectKey;
    expect(removeMock).toHaveBeenCalledWith(newKey);
  });

  it("still succeeds if deleting the OLD object fails after a committed swap", async () => {
    removeMock.mockRejectedValue(new Error("storage flaky"));
    const result = await replaceProviderDocument(baseInput());
    expect(result).toEqual({ ok: true }); // old-cleanup failure never rolls back
  });
});
