import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
const recordAuditEventMock = vi.fn();
vi.mock("@/lib/audit/record-audit-event", () => ({ recordAuditEvent: (...a: unknown[]) => recordAuditEventMock(...a) }));
const notifyMock = vi.fn();
vi.mock("@/lib/notifications/vehicle-notification-events", () => ({
  notifyProviderOfVehicleEvent: (...a: unknown[]) => notifyMock(...a),
  VEHICLE_NOTIFICATION_EVENT: { DOCUMENT_REJECTED: "vehicle.document_rejected" },
}));
// Deterministic version token = "token:" + objectKey, so we control match/mismatch.
vi.mock("@/lib/provider/documents/document-version-token", () => ({ documentVersionToken: (k: string) => `token:${k}` }));

const findUniqueMock = vi.fn();
const txUpdateManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    assetDocument: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) => cb({ assetDocument: { updateMany: (...a: unknown[]) => txUpdateManyMock(...a) } }),
  },
}));

const { reviewVehicleDocument } = await import("./review-vehicle-document");

const ownedDoc = (over: Record<string, unknown> = {}) => ({ id: "doc-1", type: "VEHICLE_REGISTRATION", status: "PENDING", objectKey: "asset-documents/a/reg/x.pdf", assetId: "asset-1", asset: { provider: { userId: "user-1" } }, ...over });
const TOKEN = "token:asset-documents/a/reg/x.pdf";

afterEach(() => vi.clearAllMocks());

describe("reviewVehicleDocument", () => {
  it("approves a PENDING document (reviewer id server-derived), audits type+status only", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
    findUniqueMock.mockResolvedValue(ownedDoc());
    txUpdateManyMock.mockResolvedValue({ count: 1 });
    const result = await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "APPROVE" });
    expect(result).toEqual({ ok: true });
    const call = txUpdateManyMock.mock.calls[0]![0];
    expect(call.where).toEqual({ id: "doc-1", objectKey: ownedDoc().objectKey, status: "PENDING" });
    expect(call.data).toMatchObject({ status: "APPROVED", reviewedByAdminId: "admin-9", rejectionReason: null });
    const audit = recordAuditEventMock.mock.calls[0]![0];
    expect(audit).toMatchObject({ actorType: "ADMIN", actorId: "admin-9", action: "vehicle.document_approved", entityType: "Vehicle", entityId: "asset-1", newValue: { type: "VEHICLE_REGISTRATION", status: "APPROVED" } });
    expect(JSON.stringify(audit)).not.toContain("asset-documents/");
    // §2/§18 — approving a document does NOT notify (avoids noise).
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("rejects a PENDING document with a reason", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
    findUniqueMock.mockResolvedValue(ownedDoc());
    txUpdateManyMock.mockResolvedValue({ count: 1 });
    const result = await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "REJECT", reason: "Blurry scan" });
    expect(result).toEqual({ ok: true });
    expect(txUpdateManyMock.mock.calls[0]![0].data).toMatchObject({ status: "REJECTED", rejectionReason: "Blurry scan" });
    expect(recordAuditEventMock.mock.calls[0]![0]).toMatchObject({ action: "vehicle.document_rejected", newValue: { type: "VEHICLE_REGISTRATION", status: "REJECTED", reason: "Blurry scan" } });
    // §18 — rejection notifies the owning provider (recipient server-derived).
    expect(notifyMock).toHaveBeenCalledWith("vehicle.document_rejected", { providerUserId: "user-1", assetId: "asset-1" });
  });

  it("requires a non-empty reason to reject", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
    expect(await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "REJECT", reason: "   " })).toEqual({ ok: false, error: "REASON_REQUIRED" });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns DOCUMENT_NOT_FOUND for a missing document", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
    findUniqueMock.mockResolvedValue(null);
    expect(await reviewVehicleDocument({ documentId: "doc-x", expectedVersionToken: TOKEN, decision: "APPROVE" })).toEqual({ ok: false, error: "DOCUMENT_NOT_FOUND" });
  });

  it("returns STALE_DOCUMENT when the document is no longer PENDING", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
    findUniqueMock.mockResolvedValue(ownedDoc({ status: "APPROVED" }));
    expect(await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "APPROVE" })).toEqual({ ok: false, error: "STALE_DOCUMENT" });
  });

  it("returns STALE_DOCUMENT on a version-token mismatch (replaced since loaded)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
    findUniqueMock.mockResolvedValue(ownedDoc());
    expect(await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: "token:STALE", decision: "APPROVE" })).toEqual({ ok: false, error: "STALE_DOCUMENT" });
    expect(txUpdateManyMock).not.toHaveBeenCalled();
  });

  it("treats a lost race (updateMany count 0) as STALE_DOCUMENT", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
    findUniqueMock.mockResolvedValue(ownedDoc());
    txUpdateManyMock.mockResolvedValue({ count: 0 });
    expect(await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "APPROVE" })).toEqual({ ok: false, error: "STALE_DOCUMENT" });
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  // VEHICLE-LC6 — admin approval is the SOLE writer of the trusted expiresAt.
  describe("LC6 trusted expiry capture", () => {
    it("APPROVE with a confirmed date writes the trusted expiresAt (next Oman midnight) + audits a safe instant", async () => {
      requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
      findUniqueMock.mockResolvedValue(ownedDoc());
      txUpdateManyMock.mockResolvedValue({ count: 1 });
      const result = await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "APPROVE", confirmedExpiryDate: "2027-05-31" });
      expect(result).toEqual({ ok: true });
      const data = txUpdateManyMock.mock.calls[0]![0].data;
      expect((data.expiresAt as Date).toISOString()).toBe("2027-05-31T20:00:00.000Z"); // Oman 2027-06-01 00:00
      expect(recordAuditEventMock.mock.calls[0]![0].newValue).toMatchObject({ status: "APPROVED", expiresAt: "2027-05-31T20:00:00.000Z" });
    });

    it("APPROVE with NO confirmed date clears/leaves the trusted expiry null", async () => {
      requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
      findUniqueMock.mockResolvedValue(ownedDoc());
      txUpdateManyMock.mockResolvedValue({ count: 1 });
      await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "APPROVE" });
      expect(txUpdateManyMock.mock.calls[0]![0].data.expiresAt).toBeNull();
    });

    it("APPROVE ignores a confirmed date for a NON-expiring document type (expiresAt stays null)", async () => {
      requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
      findUniqueMock.mockResolvedValue(ownedDoc({ type: "SOME_OTHER_DOC" }));
      txUpdateManyMock.mockResolvedValue({ count: 1 });
      await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "APPROVE", confirmedExpiryDate: "2027-05-31" });
      expect(txUpdateManyMock.mock.calls[0]![0].data.expiresAt).toBeNull();
    });

    it("APPROVE with a MALFORMED confirmed date fails the whole approval (INVALID_INPUT, no write)", async () => {
      requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
      findUniqueMock.mockResolvedValue(ownedDoc());
      expect(await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "APPROVE", confirmedExpiryDate: "2027-02-30" })).toEqual({ ok: false, error: "INVALID_INPUT" });
      expect(txUpdateManyMock).not.toHaveBeenCalled();
    });

    it("REJECT NEVER establishes a trusted expiry (no expiresAt in the write) even if a date is passed", async () => {
      requireAdminMock.mockResolvedValue({ admin: { id: "admin-9" } });
      findUniqueMock.mockResolvedValue(ownedDoc());
      txUpdateManyMock.mockResolvedValue({ count: 1 });
      await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "REJECT", reason: "Blurry", confirmedExpiryDate: "2027-05-31" });
      expect(txUpdateManyMock.mock.calls[0]![0].data).not.toHaveProperty("expiresAt");
    });
  });

  it("maps a non-admin (ForbiddenError) to NO_ADMIN_PROFILE", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireAdminMock.mockRejectedValue(new (ForbiddenError as new () => Error)());
    expect(await reviewVehicleDocument({ documentId: "doc-1", expectedVersionToken: TOKEN, decision: "APPROVE" })).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });
});
