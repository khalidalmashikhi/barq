import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const { requireAdminMock, ForbiddenError, UnauthenticatedError } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...a: unknown[]) => requireAdminMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));

const findUniqueMock = vi.fn();
const updateManyMock = vi.fn();
const auditCreateMock = vi.fn();
// Gate 3 — the post-reject PROVIDER_DOCUMENT_REJECTED notification goes through
// prisma.notification.create (via notifyProviderApplicationEvent, which imports
// this same mocked prisma). Shared so both the review write and the notify
// helper resolve against one mock.
const notificationCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    providerDocument: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    notification: { create: (...a: unknown[]) => notificationCreateMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        providerDocument: { updateMany: (...a: unknown[]) => updateManyMock(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { reviewProviderDocument } = await import("./review-provider-document");
const { documentVersionToken } = await import("./document-version-token");

const KEY = "provider-documents/prov-1/commercial_registration/v1.pdf";
const token = documentVersionToken(KEY);
// Gate 3: findUnique now includes provider.userId (the notification recipient).
const pendingDoc = {
  id: "doc-1",
  providerId: "prov-1",
  objectKey: KEY,
  type: "COMMERCIAL_REGISTRATION",
  status: "PENDING",
  provider: { userId: "user-9" },
};

beforeEach(() => {
  requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
  findUniqueMock.mockResolvedValue({ ...pendingDoc });
  updateManyMock.mockResolvedValue({ count: 1 });
  auditCreateMock.mockResolvedValue({});
  notificationCreateMock.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe("reviewProviderDocument", () => {
  it("approves a PENDING document (bound to the reviewed object), clears reason, audits", async () => {
    const result = await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "APPROVE" });
    expect(result).toEqual({ ok: true });
    const upd = updateManyMock.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(upd.where).toEqual({ id: "doc-1", objectKey: KEY, status: "PENDING" });
    expect(upd.data).toMatchObject({ status: "APPROVED", reviewedByAdminId: "admin-1", rejectionReason: null });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider.document_approved", actorType: "ADMIN" } });
  });

  it("rejects a PENDING document with a trimmed reason, stored + audited", async () => {
    const result = await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "REJECT", reason: "  unreadable scan  " });
    expect(result).toEqual({ ok: true });
    const upd = updateManyMock.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(upd.data).toMatchObject({ status: "REJECTED", rejectionReason: "unreadable scan" });
    const audit = auditCreateMock.mock.calls[0]![0] as { data: { action: string; newValue: { reason: string } } };
    expect(audit.data.action).toBe("provider.document_rejected");
    expect(audit.data.newValue.reason).toBe("unreadable scan");
  });

  it("requires a non-empty reason to reject", async () => {
    expect(await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "REJECT", reason: "   " })).toEqual({ ok: false, error: "REASON_REQUIRED" });
    expect(await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "REJECT" })).toEqual({ ok: false, error: "REASON_REQUIRED" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("STALE_DOCUMENT when the provider replaced the doc after the admin loaded it (token mismatch) — the core race", async () => {
    // Admin reviewed KEY, but the current object is now a different key.
    findUniqueMock.mockResolvedValue({ ...pendingDoc, objectKey: "provider-documents/prov-1/commercial_registration/v2.pdf" });
    const result = await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "APPROVE" });
    expect(result).toEqual({ ok: false, error: "STALE_DOCUMENT" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("STALE_DOCUMENT when the document is no longer PENDING (already reviewed)", async () => {
    findUniqueMock.mockResolvedValue({ ...pendingDoc, status: "APPROVED" });
    expect(await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "REJECT", reason: "x" })).toEqual({ ok: false, error: "STALE_DOCUMENT" });
  });

  it("STALE_DOCUMENT when the atomic conditional update matches 0 rows (concurrent winner)", async () => {
    updateManyMock.mockResolvedValue({ count: 0 });
    expect(await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "APPROVE" })).toEqual({ ok: false, error: "STALE_DOCUMENT" });
  });

  it("maps a non-admin caller to NO_ADMIN_PROFILE", async () => {
    requireAdminMock.mockRejectedValue(new ForbiddenError());
    expect(await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "APPROVE" })).toEqual({ ok: false, error: "NO_ADMIN_PROFILE" });
  });

  // ---- Gate 3: PROVIDER_DOCUMENT_REJECTED notification ----

  it("creates a PROVIDER_DOCUMENT_REJECTED notification for the provider's user on a successful reject", async () => {
    await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "REJECT", reason: "blurry scan" });

    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    const arg = notificationCreateMock.mock.calls[0]![0] as {
      data: { userId: string; channel: string; eventType: string; entityType: string; entityId: string; content: Record<string, unknown> };
    };
    expect(arg.data.userId).toBe("user-9");
    expect(arg.data.channel).toBe("IN_APP");
    expect(arg.data.eventType).toBe("provider.document_rejected");
    expect(arg.data.entityType).toBe("Provider");
    expect(arg.data.entityId).toBe("prov-1");
    expect(arg.data.content.kind).toBe("PROVIDER_DOCUMENT_REJECTED");
    // Static, fully-localized content (all 8 BARQ locales), and NOT tied to a booking.
    for (const locale of ["ar", "en", "de", "it", "pl", "fr", "cs", "ru"]) {
      expect(typeof arg.data.content[locale]).toBe("string");
    }
    expect("causingBookingId" in arg.data).toBe(false);
  });

  it("never embeds the admin's free-text rejection reason in the notification content", async () => {
    await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "REJECT", reason: "SENSITIVE-REASON-TOKEN" });

    const arg = notificationCreateMock.mock.calls[0]![0] as { data: { content: Record<string, unknown> } };
    expect(JSON.stringify(arg.data.content)).not.toContain("SENSITIVE-REASON-TOKEN");
  });

  it("does NOT create a notification on approve", async () => {
    await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "APPROVE" });
    expect(notificationCreateMock).not.toHaveBeenCalled();
  });

  it("still succeeds (review committed) even if the notification write throws", async () => {
    notificationCreateMock.mockRejectedValue(new Error("notification store down"));
    const result = await reviewProviderDocument({ documentId: "doc-1", expectedVersionToken: token, decision: "REJECT", reason: "blurry scan" });
    // The review must NOT roll back or report failure — the notification is
    // fire-and-forget after the committed transaction.
    expect(result).toEqual({ ok: true });
    expect(updateManyMock).toHaveBeenCalledTimes(1);
  });
});
