import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && (v.startsWith("asset-") || v.startsWith("doc-")) }));

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
const uploadPrivateObjectMock = vi.fn();
vi.mock("@/lib/storage/storage", () => ({
  isDocumentStorageConfigured: () => true,
  uploadPrivateObject: (...a: unknown[]) => uploadPrivateObjectMock(...a),
}));
const enqueueCleanupMock = vi.fn();
const attemptCleanupMock = vi.fn();
const registerIntentMock = vi.fn();
const releaseIntentMock = vi.fn();
vi.mock("@/lib/storage/cleanup/private-object-cleanup", () => ({
  enqueuePrivateObjectCleanup: (...a: unknown[]) => enqueueCleanupMock(...a),
  attemptPrivateObjectCleanup: (...a: unknown[]) => attemptCleanupMock(...a),
  registerUploadIntent: (...a: unknown[]) => registerIntentMock(...a),
  releaseUploadIntent: (...a: unknown[]) => releaseIntentMock(...a),
}));
const validateMock = vi.fn();
vi.mock("@/lib/provider/documents/document-constants", () => ({ validateDocumentUpload: (a: unknown) => validateMock(a) }));

const docFindFirstMock = vi.fn();
const txUpdateManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    assetDocument: { findFirst: (...a: unknown[]) => docFindFirstMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb({ assetDocument: { updateMany: (...a: unknown[]) => txUpdateManyMock(...a) } }),
  },
}));

const { replaceVehicleDocument } = await import("./replace-vehicle-document");

const VEHICLE = "asset-1";
const INPUT = { originalFilename: "new.pdf", declaredMimeType: "application/pdf", bytes: new ArrayBuffer(512) };
const ownedDoc = (over: Record<string, unknown> = {}) => ({ id: "doc-1", type: "VEHICLE_REGISTRATION", status: "PENDING", objectKey: "asset-documents/asset-1/vehicle_registration/old.pdf", assetId: "asset-1", asset: { verificationStatus: "DRAFT" }, ...over });

function happy() {
  requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
  docFindFirstMock.mockResolvedValue(ownedDoc());
  validateMock.mockReturnValue({ ok: true, format: "pdf", ext: "pdf", mimeType: "application/pdf" });
  uploadPrivateObjectMock.mockResolvedValue(undefined);
  txUpdateManyMock.mockResolvedValue({ count: 1 });
  enqueueCleanupMock.mockResolvedValue("cleanup-task-old");
  attemptCleanupMock.mockResolvedValue("completed");
  registerIntentMock.mockResolvedValue("intent-task-new");
  releaseIntentMock.mockResolvedValue(true);
}

afterEach(() => {
  vi.clearAllMocks();
  validateMock.mockReturnValue({ ok: true, format: "pdf", ext: "pdf", mimeType: "application/pdf" });
});

describe("replaceVehicleDocument", () => {
  it("swaps a PENDING doc to a new object (PENDING) and removes the OLD object after commit", async () => {
    happy();
    const result = await replaceVehicleDocument(VEHICLE, "doc-1", INPUT);
    expect(result).toEqual({ ok: true });
    expect(uploadPrivateObjectMock).toHaveBeenCalledOnce();
    // Ownership + path-binding: query is scoped by BOTH assetId (vehicleId) and provider.
    expect(docFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "doc-1", assetId: "asset-1", asset: { providerId: "prov-1", assetType: "VEHICLE" } } }));
    // RC3: updateMany is bound to the seen objectKey.
    expect(txUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "doc-1", objectKey: ownedDoc().objectKey } }));
    // Durable cleanup: the SUPERSEDED (old) object is enqueued in-tx, then an immediate attempt runs.
    expect(enqueueCleanupMock.mock.calls[0]![1]).toMatchObject({ objectKey: ownedDoc().objectKey, purpose: "VEHICLE_DOCUMENT_REPLACEMENT" });
    expect(attemptCleanupMock).toHaveBeenCalledOnce();
    expect(attemptCleanupMock).toHaveBeenCalledWith("cleanup-task-old"); // ONLY the old object is deleted
    // INTENT-FIRST for the NEW object: recorded before the write, released in the swap transaction.
    const newKey = (uploadPrivateObjectMock.mock.calls[0]![0] as { objectKey: string }).objectKey;
    expect(registerIntentMock).toHaveBeenCalledWith(newKey);
    expect(registerIntentMock.mock.invocationCallOrder[0]!).toBeLessThan(uploadPrivateObjectMock.mock.invocationCallOrder[0]!);
    expect(releaseIntentMock.mock.calls[0]![1]).toBe(newKey);
    expect(newKey).not.toBe(ownedDoc().objectKey);
    const audit = recordAuditEventMock.mock.calls[0]![0];
    expect(audit).toMatchObject({ action: "vehicle.document_replaced", entityType: "Vehicle" });
    expect(JSON.stringify(audit)).not.toContain("asset-documents/");
  });

  it("rejects an invalid document id before auth", async () => {
    expect(await replaceVehicleDocument(VEHICLE, "bad", INPUT)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid vehicle id before auth", async () => {
    expect(await replaceVehicleDocument("bad", "doc-1", INPUT)).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("PATH-BINDING: a provider's own vehicle-B document via vehicle-A URL is uniform DOCUMENT_NOT_FOUND", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    validateMock.mockReturnValue({ ok: true, format: "pdf", ext: "pdf", mimeType: "application/pdf" });
    // The DB only returns the row when where.assetId matches the doc's real assetId (asset-1).
    docFindFirstMock.mockImplementation((args: { where?: { assetId?: string } }) => Promise.resolve(args?.where?.assetId === "asset-1" ? ownedDoc() : null));
    // Caller owns both vehicles but names the WRONG one (asset-2) in the URL for a doc on asset-1.
    const result = await replaceVehicleDocument("asset-2", "doc-1", INPUT);
    expect(result).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
  });

  it("returns DOCUMENT_NOT_FOUND for a foreign/missing document", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    docFindFirstMock.mockResolvedValue(null);
    expect(await replaceVehicleDocument(VEHICLE, "doc-x", INPUT)).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
  });

  it("returns LOCKED when verification is not editable", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    docFindFirstMock.mockResolvedValue(ownedDoc({ asset: { verificationStatus: "SUBMITTED" } }));
    expect(await replaceVehicleDocument(VEHICLE, "doc-1", INPUT)).toEqual({ ok: false, error: "LOCKED" });
  });

  it("returns LOCKED when replacing an APPROVED document (deferred policy)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    docFindFirstMock.mockResolvedValue(ownedDoc({ status: "APPROVED" }));
    expect(await replaceVehicleDocument(VEHICLE, "doc-1", INPUT)).toEqual({ ok: false, error: "LOCKED" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
  });

  it("allows replacing a REJECTED document", async () => {
    happy();
    docFindFirstMock.mockResolvedValue(ownedDoc({ status: "REJECTED" }));
    expect(await replaceVehicleDocument(VEHICLE, "doc-1", INPUT)).toEqual({ ok: true });
  });

  it("treats a lost race (updateMany count 0) as DOCUMENT_NOT_FOUND and removes the NEW object", async () => {
    happy();
    txUpdateManyMock.mockResolvedValue({ count: 0 });
    const result = await replaceVehicleDocument(VEHICLE, "doc-1", INPUT);
    expect(result).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
    // The swap did NOT commit → the NEW object's still-recorded intent is attempted; the OLD (still
    // active) object is never queued or deleted.
    expect(attemptCleanupMock).toHaveBeenCalledOnce();
    expect(attemptCleanupMock).toHaveBeenCalledWith("intent-task-new");
    expect(enqueueCleanupMock).not.toHaveBeenCalled();
    expect(releaseIntentMock).not.toHaveBeenCalled(); // the stale guard fires before the release
  });

  it("fails CLOSED without uploading when the upload intent cannot be recorded", async () => {
    happy();
    registerIntentMock.mockRejectedValue(new Error("db down"));
    expect(await replaceVehicleDocument(VEHICLE, "doc-1", INPUT)).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
    expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  // VEHICLE-LC6 — provider claim + stale-trust clearing on replacement.
  describe("LC6 expiry capture", () => {
    it("stores the NEW provider claim and CLEARS the old trusted expiresAt (stale-trust safety)", async () => {
      happy();
      const result = await replaceVehicleDocument(VEHICLE, "doc-1", { ...INPUT, claimedExpiryDate: "2027-05-31" });
      expect(result).toEqual({ ok: true });
      const data = txUpdateManyMock.mock.calls[0]![0].data;
      expect(data.claimedExpiryDate).toBe("2027-05-31"); // new advisory claim
      expect(data.expiresAt).toBeNull(); // trusted expiry cleared until admin re-confirms
      expect(data.status).toBe("PENDING");
    });

    it("rejects a malformed claim as INVALID_INPUT before any storage/DB write", async () => {
      happy();
      expect(await replaceVehicleDocument(VEHICLE, "doc-1", { ...INPUT, claimedExpiryDate: "2027-02-30" })).toEqual({ ok: false, error: "INVALID_INPUT" });
      expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
      expect(txUpdateManyMock).not.toHaveBeenCalled();
    });
  });

  // VEHICLE-LC5 — the narrow expired-required-document remediation exception.
  describe("LC5 remediation (APPROVED verification)", () => {
    const PAST = new Date("2000-01-01T00:00:00Z");
    const FUTURE = new Date("2999-01-01T00:00:00Z");

    it("allows replacing an EXPIRED APPROVED required document (→ PENDING)", async () => {
      happy();
      docFindFirstMock.mockResolvedValue(ownedDoc({ status: "APPROVED", expiresAt: PAST, asset: { verificationStatus: "APPROVED" } }));
      const result = await replaceVehicleDocument(VEHICLE, "doc-1", INPUT);
      expect(result).toEqual({ ok: true });
      // Resets to PENDING (returns to admin review); verificationStatus is untouched here.
      expect(txUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING" }) }));
    });

    it("allows replacing a REJECTED required document under APPROVED (an LC5 retry)", async () => {
      happy();
      docFindFirstMock.mockResolvedValue(ownedDoc({ status: "REJECTED", expiresAt: null, asset: { verificationStatus: "APPROVED" } }));
      expect(await replaceVehicleDocument(VEHICLE, "doc-1", INPUT)).toEqual({ ok: true });
    });

    it("LOCKS a VALID (unexpired) APPROVED required document — no arbitrary APPROVED editing", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
      docFindFirstMock.mockResolvedValue(ownedDoc({ status: "APPROVED", expiresAt: FUTURE, asset: { verificationStatus: "APPROVED" } }));
      expect(await replaceVehicleDocument(VEHICLE, "doc-1", INPUT)).toEqual({ ok: false, error: "LOCKED" });
      expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
    });

    it("LOCKS a PENDING document under APPROVED — fail-closed while in the admin's hands", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
      docFindFirstMock.mockResolvedValue(ownedDoc({ status: "PENDING", expiresAt: PAST, asset: { verificationStatus: "APPROVED" } }));
      expect(await replaceVehicleDocument(VEHICLE, "doc-1", INPUT)).toEqual({ ok: false, error: "LOCKED" });
      expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
    });

    it("LOCKS an expired APPROVED but NON-required document under APPROVED", async () => {
      requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
      docFindFirstMock.mockResolvedValue(ownedDoc({ type: "SOME_OPTIONAL_DOC", status: "APPROVED", expiresAt: PAST, asset: { verificationStatus: "APPROVED" } }));
      expect(await replaceVehicleDocument(VEHICLE, "doc-1", INPUT)).toEqual({ ok: false, error: "LOCKED" });
      expect(uploadPrivateObjectMock).not.toHaveBeenCalled();
    });
  });
});
