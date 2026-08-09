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
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { reviewProviderDocument } = await import("./review-provider-document");
const { documentVersionToken } = await import("./document-version-token");

const KEY = "provider-documents/prov-1/commercial_registration/v1.pdf";
const token = documentVersionToken(KEY);
const pendingDoc = { id: "doc-1", providerId: "prov-1", objectKey: KEY, type: "COMMERCIAL_REGISTRATION", status: "PENDING" };

beforeEach(() => {
  requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
  findUniqueMock.mockResolvedValue({ ...pendingDoc });
  updateManyMock.mockResolvedValue({ count: 1 });
  auditCreateMock.mockResolvedValue({});
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
});
