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
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: () => isConfiguredMock(),
  uploadPrivateObject: (...a: unknown[]) => uploadPrivateObjectMock(...a),
}));
const registerIntentMock = vi.fn();
const releaseIntentMock = vi.fn();
const attemptCleanupMock = vi.fn();
vi.mock("@/lib/storage/cleanup/private-object-cleanup", () => ({
  registerUploadIntent: (...a: unknown[]) => registerIntentMock(...a),
  releaseUploadIntent: (...a: unknown[]) => releaseIntentMock(...a),
  attemptPrivateObjectCleanup: (...a: unknown[]) => attemptCleanupMock(...a),
}));

// The single preparation authority (validation + normalization) is covered by prepare-vehicle-document.test.ts
// with the REAL decoder; here it is a seam.
const prepareMock = vi.fn();
vi.mock("./prepare-vehicle-document", () => ({ prepareVehicleDocumentForStorage: (a: unknown) => prepareMock(a) }));

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
  prepareMock.mockResolvedValue({ ok: true, bytes: new ArrayBuffer(1024), mimeType: "application/pdf", ext: "pdf", normalized: false });
  uploadPrivateObjectMock.mockResolvedValue(undefined);
  txDocCreateMock.mockResolvedValue({ id: "doc-1" });
  registerIntentMock.mockResolvedValue("intent-task-1");
  releaseIntentMock.mockResolvedValue(true);
  attemptCleanupMock.mockResolvedValue("completed");
}

afterEach(() => {
  vi.clearAllMocks();
  isConfiguredMock.mockReturnValue(true);
  prepareMock.mockResolvedValue({ ok: true, bytes: new ArrayBuffer(1024), mimeType: "application/pdf", ext: "pdf", normalized: false });
});

describe("uploadVehicleDocument", () => {
  it("VEHICLE-LC6 — stores a valid provider CLAIM but NEVER writes the trusted expiresAt", async () => {
    happy();
    expect(await uploadVehicleDocument("asset-1", { ...INPUT, claimedExpiryDate: "2027-05-31" })).toEqual({ ok: true, documentId: "doc-1" });
    const data = txDocCreateMock.mock.calls[0]![0].data;
    expect(data.claimedExpiryDate).toBe("2027-05-31"); // advisory claim stored
    expect(data).not.toHaveProperty("expiresAt"); // provider can NEVER set the trusted value
  });

  it("VEHICLE-LC6 — rejects a malformed claim as INVALID_INPUT before any storage/DB write", async () => {
    happy();
    expect(await uploadVehicleDocument("asset-1", { ...INPUT, claimedExpiryDate: "2027-02-30" })).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
    expect(txDocCreateMock).not.toHaveBeenCalled();
  });

  it("uploads a PENDING doc for an owned editable vehicle and audits type+status only", async () => {
    happy();
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: true, documentId: "doc-1" });
    expect(uploadPrivateObjectMock).toHaveBeenCalledOnce();
    expect(txDocCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ assetId: "asset-1", type: "VEHICLE_REGISTRATION", status: "PENDING", claimedExpiryDate: null }) });
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
    prepareMock.mockResolvedValue({ ok: false, error: "TOO_LARGE" });
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "TOO_LARGE" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
  });

  it("stores the PREPARED (normalized) bytes, type and extension — never the request's own", async () => {
    happy();
    const normalized = new ArrayBuffer(777);
    prepareMock.mockResolvedValue({ ok: true, bytes: normalized, mimeType: "image/jpeg", ext: "jpg", normalized: true });
    const result = await uploadVehicleDocument("asset-1", { ...INPUT, originalFilename: "card.png", declaredMimeType: "image/png" });
    expect(result).toEqual({ ok: true, documentId: "doc-1" });
    const stored = uploadPrivateObjectMock.mock.calls[0]![0] as { objectKey: string; body: ArrayBuffer; contentType: string };
    expect(stored.body).toBe(normalized);
    expect(stored.contentType).toBe("image/jpeg");
    expect(stored.objectKey.endsWith(".jpg")).toBe(true);
    expect(txDocCreateMock.mock.calls[0]![0].data).toMatchObject({ mimeType: "image/jpeg", sizeBytes: 777 });
  });

  it("the vehicle document TYPE is passed to the policy (it alone decides the registration-only rule)", async () => {
    happy();
    await uploadVehicleDocument("asset-1", INPUT);
    expect(prepareMock.mock.calls[0]![0]).toMatchObject({ documentType: "VEHICLE_REGISTRATION" });
    prepareMock.mockClear();
    await uploadVehicleDocument("asset-1", { ...INPUT, type: "VEHICLE_INSURANCE" });
    expect(prepareMock.mock.calls[0]![0]).toMatchObject({ documentType: "VEHICLE_INSURANCE" });
  });

  it.each(["HEIC_UNSUPPORTED", "IMAGE_TOO_LARGE", "IMAGE_CORRUPT", "PDF_ENCRYPTED", "PDF_CORRUPT", "PDF_TOO_MANY_PAGES", "SIGNATURE_MISMATCH", "UNSUPPORTED_TYPE"])(
    "propagates %s from preparation and stores nothing",
    async (code) => {
      happy();
      prepareMock.mockResolvedValue({ ok: false, error: code });
      expect(await uploadVehicleDocument("asset-1", INPUT)).toEqual({ ok: false, error: code });
      expect(registerIntentMock).not.toHaveBeenCalled();
      expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
    },
  );

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

  it("INTENT-FIRST: the server-generated key is durably recorded BEFORE the object is written, and released in the row's transaction", async () => {
    happy();
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: true, documentId: "doc-1" });
    const intentKey = registerIntentMock.mock.calls[0]![0] as string;
    const uploadedKey = (uploadPrivateObjectMock.mock.calls[0]![0] as { objectKey: string }).objectKey;
    expect(intentKey).toBe(uploadedKey); // same server-generated key
    expect(registerIntentMock.mock.invocationCallOrder[0]!).toBeLessThan(uploadPrivateObjectMock.mock.invocationCallOrder[0]!);
    expect(releaseIntentMock.mock.calls[0]![1]).toBe(uploadedKey);
    expect(attemptCleanupMock).not.toHaveBeenCalled(); // nothing to clean on success
  });

  it("fails CLOSED without uploading when the intent cannot be recorded", async () => {
    happy();
    registerIntentMock.mockRejectedValue(new Error("db down"));
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
  });

  it("storage write failure → resolves the intent (possibly-partial object) and returns UPLOAD_FAILED", async () => {
    happy();
    uploadPrivateObjectMock.mockRejectedValue(new Error("storage down"));
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "UPLOAD_FAILED" });
    expect(attemptCleanupMock).toHaveBeenCalledWith("intent-task-1");
  });

  it("DB write failure after a successful upload → the still-recorded intent is attempted (durable, retried by the worker)", async () => {
    happy();
    txDocCreateMock.mockRejectedValue(new Error("db down"));
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(attemptCleanupMock).toHaveBeenCalledOnce();
    expect(attemptCleanupMock).toHaveBeenCalledWith("intent-task-1");
  });

  it("an intent the worker already took cannot be released → the row is NOT persisted", async () => {
    happy();
    releaseIntentMock.mockResolvedValue(false);
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(txDocCreateMock).not.toHaveBeenCalled();
  });

  it("maps a lost (assetId,type) unique race (P2002) to ALREADY_EXISTS + durable cleanup of the loser's object", async () => {
    happy();
    txDocCreateMock.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "5.22.0" }));
    const result = await uploadVehicleDocument("asset-1", INPUT);
    expect(result).toEqual({ ok: false, error: "ALREADY_EXISTS" });
    expect(attemptCleanupMock).toHaveBeenCalledWith("intent-task-1");
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
