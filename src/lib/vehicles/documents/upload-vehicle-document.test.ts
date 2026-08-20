import { describe, it, expect, vi, afterEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.startsWith("asset-") }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError: class ForbiddenError extends Error {
    code?: string;
    constructor(m?: string, c?: string) {
      super(m);
      this.code = c;
    }
  },
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a) }));

const isConfiguredMock = vi.fn(() => true);
const uploadPrivateObjectMock = vi.fn();
const removePrivateObjectMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: () => isConfiguredMock(),
  uploadPrivateObject: (...a: unknown[]) => uploadPrivateObjectMock(...a),
  removePrivateObject: (...a: unknown[]) => removePrivateObjectMock(...a),
}));

const validateMock = vi.fn();
vi.mock("@/lib/provider/documents/document-constants", () => ({ validateDocumentUpload: (a: unknown) => validateMock(a) }));

const assetFindFirstMock = vi.fn();
const docFindUniqueMock = vi.fn();
const txDocCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    asset: { findFirst: (...a: unknown[]) => assetFindFirstMock(...a) },
    assetDocument: { findUnique: (...a: unknown[]) => docFindUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb({ assetDocument: { create: (...a: unknown[]) => txDocCreateMock(...a) } }),
  },
}));

const { uploadVehicleDocument } = await import("./upload-vehicle-document");

const INPUT = { type: "VEHICLE_REGISTRATION", originalFilename: "reg.pdf", declaredMimeType: "application/pdf", bytes: new ArrayBuffer(1024) };

function happy() {
  requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
  assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "DRAFT" });
  docFindUniqueMock.mockResolvedValue(null);
  isConfiguredMock.mockReturnValue(true);
  validateMock.mockReturnValue({ ok: true, format: "pdf", ext: "pdf", mimeType: "application/pdf" });
  uploadPrivateObjectMock.mockResolvedValue(undefined);
  txDocCreateMock.mockResolvedValue({ id: "doc-1" });
}

afterEach(() => {
  vi.clearAllMocks();
  isConfiguredMock.mockReturnValue(true);
  validateMock.mockReturnValue({ ok: true, format: "pdf", ext: "pdf", mimeType: "application/pdf" });
});

describe("uploadVehicleDocument", () => {
  it("uploads a PENDING doc for an owned editable vehicle and audits type+status only", async () => {
    happy();
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: true, documentId: "doc-1" });
    expect(uploadPrivateObjectMock).toHaveBeenCalledOnce();
    expect(txDocCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ assetId: "asset-1", type: "VEHICLE_REGISTRATION", status: "PENDING" }) });
    const audit = recordAuditEventMock.mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "vehicle.document_uploaded", entityType: "Vehicle", entityId: "asset-1", newValue: { type: "VEHICLE_REGISTRATION", status: "PENDING" } });
    // Privacy: audit never carries the objectKey, filename, or file bytes.
    expect(JSON.stringify(audit)).not.toContain("reg.pdf");
    expect(JSON.stringify(audit)).not.toContain("asset-documents/");
  });

  it("rejects an invalid vehicle id before any auth", async () => {
    const result = await uploadVehicleDocument("not-a-uuid", INPUT);
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("rejects an off-registry document type (no client-invented types)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    const result = await uploadVehicleDocument("asset-1", { ...INPUT, type: "PASSPORT" });
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(assetFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns VEHICLE_NOT_FOUND for a foreign/missing vehicle (scoped by providerId)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue(null);
    const result = await uploadVehicleDocument("asset-x", INPUT);
    expect(result).toEqual({ ok: false, error: "VEHICLE_NOT_FOUND" });
    expect(assetFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "asset-x", providerId: "prov-1", assetType: "VEHICLE" } }));
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
  });

  it("returns LOCKED when the vehicle verification is not editable", async () => {
    happy();
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "SUBMITTED" });
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "LOCKED" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
  });

  it("propagates a file-validation failure without touching storage", async () => {
    happy();
    validateMock.mockReturnValue({ ok: false, error: "TOO_LARGE" });
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "TOO_LARGE" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
  });

  it("returns STORAGE_NOT_CONFIGURED when the private bucket is absent", async () => {
    happy();
    isConfiguredMock.mockReturnValue(false);
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "STORAGE_NOT_CONFIGURED" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
  });

  it("returns ALREADY_EXISTS when a doc of the type is present (use Replace)", async () => {
    happy();
    docFindUniqueMock.mockResolvedValue({ id: "doc-existing" });
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "ALREADY_EXISTS" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
  });

  it("cleans up the orphaned object when the DB write fails", async () => {
    happy();
    txDocCreateMock.mockRejectedValue(new Error("db down"));
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(removePrivateObjectMock).toHaveBeenCalledOnce();
  });

  it("maps a lost (assetId,type) unique race (P2002) to ALREADY_EXISTS + cleanup", async () => {
    happy();
    txDocCreateMock.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" }));
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "ALREADY_EXISTS" });
    expect(removePrivateObjectMock).toHaveBeenCalledOnce();
  });

  it("maps a not-approved provider to PROVIDER_NOT_APPROVED", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireApprovedProviderMock.mockRejectedValue(new (ForbiddenError as new (m?: string, c?: string) => Error)("nope", "PROVIDER_NOT_APPROVED"));
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "PROVIDER_NOT_APPROVED" });
  });

  it("re-throws UnauthenticatedError (transport redirects to login)", async () => {
    const { UnauthenticatedError } = await import("@/lib/auth");
    requireApprovedProviderMock.mockRejectedValue(new (UnauthenticatedError as new () => Error)());
    await expect(uploadVehicleDocument("asset-1", INPUT)).rejects.toBeInstanceOf(UnauthenticatedError as new () => Error);
  });
});
