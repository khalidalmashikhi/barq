import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 3B — Phase 1. Admin review of provider verticals. approve/reject/request-changes gate on
// providers.review; suspend/reactivate on providers.manage (reused RBAC, no new permission). Every
// transition is STATE-GUARDED (a concurrent loser → VERTICAL_STATE_CONFLICT) and writes an
// actor-attributed AuditLog row in the same transaction. Reactivation restores APPROVED but does
// NOT republish any listing (no listing writes happen here at all).

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const { requirePermissionMock, ForbiddenError, UnauthenticatedError } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthenticatedError: class UnauthenticatedError extends Error {},
}));
vi.mock("@/lib/auth", () => ({
  requirePermission: (...a: unknown[]) => requirePermissionMock(...a),
  ForbiddenError,
  UnauthenticatedError,
}));

const findUniqueMock = vi.fn();
const updateManyMock = vi.fn();
const auditCreateMock = vi.fn();
const serviceFindManyMock = vi.fn();
const serviceUpdateManyMock = vi.fn();
// Blocker 3 — approval/reactivation run the vertical document gate (assertVerticalApprovable),
// which reads the requirement policy + the provider's documents.
const requirementFindManyMock = vi.fn();
const documentFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    providerVertical: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    providerVerificationRequirement: { findMany: (...a: unknown[]) => requirementFindManyMock(...a) },
    providerDocument: { findMany: (...a: unknown[]) => documentFindManyMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        providerVertical: { updateMany: (...a: unknown[]) => updateManyMock(...a) },
        // Suspension hides the provider's PUBLISHED listings in this vertical, in the same tx.
        service: {
          findMany: (...a: unknown[]) => serviceFindManyMock(...a),
          updateMany: (...a: unknown[]) => serviceUpdateManyMock(...a),
        },
        // The approval document gate re-checks INSIDE the tx (TOCTOU safety), so the tx client
        // exposes the same requirement + document readers.
        providerVerificationRequirement: { findMany: (...a: unknown[]) => requirementFindManyMock(...a) },
        providerDocument: { findMany: (...a: unknown[]) => documentFindManyMock(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const {
  approveProviderVertical,
  rejectProviderVertical,
  requestProviderVerticalChanges,
  suspendProviderVertical,
  reactivateProviderVertical,
} = await import("./review-provider-vertical");

const VID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

function existing(status: string) {
  findUniqueMock.mockResolvedValue({ status, vertical: "RENTAL_COMPANY", providerId: "provider-1" });
}

beforeEach(() => {
  requirePermissionMock.mockResolvedValue({
    actor: { actorType: "ADMIN", actorId: "admin-1", admin: { id: "admin-1" } },
  });
  updateManyMock.mockResolvedValue({ count: 1 });
  auditCreateMock.mockResolvedValue({});
  serviceFindManyMock.mockResolvedValue([]);
  serviceUpdateManyMock.mockResolvedValue({ count: 0 });
  // Default: a CONFIGURED, satisfied RENTAL_COMPANY policy (existing() defaults to that vertical) so
  // the generic approve/reactivate transition tests are READY. Empty policy now fails closed
  // (POLICY_NOT_CONFIGURED), so a configured+approved requirement is the correct "ready" baseline.
  requirementFindManyMock.mockResolvedValue([
    { key: "RENTAL_ACTIVITY_LICENCE", appliesTo: "RENTAL_COMPANY", required: true, active: true, evidenceExpires: false },
  ]);
  documentFindManyMock.mockResolvedValue([{ type: "RENTAL_ACTIVITY_LICENCE", status: "APPROVED", expiresAt: null }]);
});
afterEach(() => vi.clearAllMocks());

describe("review-provider-vertical — RBAC & input", () => {
  it("rejects a malformed vertical id before any auth or DB", async () => {
    expect(await approveProviderVertical("not-a-uuid")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requirePermissionMock).not.toHaveBeenCalled();
  });

  it("approve/reject/request-changes require providers.review; suspend/reactivate require providers.manage", async () => {
    existing("PENDING_REVIEW");
    await approveProviderVertical(VID);
    expect(requirePermissionMock).toHaveBeenLastCalledWith("providers.review");
    await rejectProviderVertical(VID, "bad docs");
    expect(requirePermissionMock).toHaveBeenLastCalledWith("providers.review");
    await requestProviderVerticalChanges(VID, "need X");
    expect(requirePermissionMock).toHaveBeenLastCalledWith("providers.review");
    existing("APPROVED");
    await suspendProviderVertical(VID, "violation");
    expect(requirePermissionMock).toHaveBeenLastCalledWith("providers.manage");
    existing("SUSPENDED");
    await reactivateProviderVertical(VID);
    expect(requirePermissionMock).toHaveBeenLastCalledWith("providers.manage");
  });

  it("maps a permission ForbiddenError to FORBIDDEN", async () => {
    requirePermissionMock.mockRejectedValue(new ForbiddenError());
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("returns VERTICAL_NOT_FOUND when the vertical does not exist", async () => {
    findUniqueMock.mockResolvedValue(null);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_NOT_FOUND" });
  });

  it("requires a non-empty reason for reject / request-changes / suspend", async () => {
    expect(await rejectProviderVertical(VID, "   ")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await requestProviderVerticalChanges(VID, "")).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(await suspendProviderVertical(VID, "  ")).toEqual({ ok: false, error: "INVALID_INPUT" });
  });
});

describe("review-provider-vertical — transitions, state guard & audit", () => {
  it("approves a PENDING vertical: state-guarded updateMany, clears suspendedAt, audits", async () => {
    existing("PENDING_REVIEW");
    const result = await approveProviderVertical(VID);
    expect(result).toEqual({ ok: true });
    const upd = updateManyMock.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(upd.where).toEqual({ id: VID, status: { in: ["PENDING_REVIEW", "CHANGES_REQUESTED"] } });
    expect(upd.data).toMatchObject({ status: "APPROVED", reviewedByAdminId: "admin-1", suspendedAt: null });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({
      data: { action: "provider_vertical.approved", actorType: "ADMIN", actorId: "admin-1" },
    });
  });

  it("rejects from PENDING/CHANGES → REJECTED, persisting the reason", async () => {
    existing("PENDING_REVIEW");
    expect(await rejectProviderVertical(VID, "insufficient license")).toEqual({ ok: true });
    const upd = updateManyMock.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(upd.where).toEqual({ id: VID, status: { in: ["PENDING_REVIEW", "CHANGES_REQUESTED"] } });
    expect(upd.data).toMatchObject({ status: "REJECTED", reason: "insufficient license" });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider_vertical.rejected" } });
  });

  it("requests changes ONLY from PENDING_REVIEW → CHANGES_REQUESTED", async () => {
    existing("PENDING_REVIEW");
    expect(await requestProviderVerticalChanges(VID, "add registration doc")).toEqual({ ok: true });
    const upd = updateManyMock.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(upd.where).toEqual({ id: VID, status: { in: ["PENDING_REVIEW"] } });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({
      data: { action: "provider_vertical.changes_requested" },
    });
  });

  it("suspends ONLY an APPROVED vertical, stamping suspendedAt + reason", async () => {
    existing("APPROVED");
    expect(await suspendProviderVertical(VID, "safety complaint")).toEqual({ ok: true });
    const upd = updateManyMock.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(upd.where).toEqual({ id: VID, status: { in: ["APPROVED"] } });
    expect(upd.data).toMatchObject({ status: "SUSPENDED", reason: "safety complaint" });
    expect(upd.data.suspendedAt).toBeInstanceOf(Date);
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider_vertical.suspended" } });
  });

  it("suspension HIDES the provider's PUBLISHED listings in THIS vertical only (PUBLISHED → PAUSED), recording the ids in the audit trail", async () => {
    existing("APPROVED");
    serviceFindManyMock.mockResolvedValue([{ id: "svc-a" }, { id: "svc-b" }]);
    serviceUpdateManyMock.mockResolvedValue({ count: 2 });

    expect(await suspendProviderVertical(VID, "license revoked")).toEqual({ ok: true });

    // Only this provider's PUBLISHED services carrying the vertical's regulated kind are selected —
    // unrelated verticals (different offeringKind) and non-PUBLISHED services are never matched.
    expect(serviceFindManyMock).toHaveBeenCalledWith({
      where: { providerId: "provider-1", status: "PUBLISHED", offeringKind: { in: ["VEHICLE_RENTAL"] } },
      select: { id: true },
    });
    expect(serviceUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["svc-a", "svc-b"] } },
      data: { status: "PAUSED" },
    });
    // The enforcement action is captured in the audit event.
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({
      data: {
        action: "provider_vertical.suspended",
        newValue: expect.objectContaining({ status: "SUSPENDED", hiddenServiceIds: ["svc-a", "svc-b"] }),
      },
    });
  });

  it("suspension with no published listings succeeds without any service update (bookings untouched)", async () => {
    existing("APPROVED");
    serviceFindManyMock.mockResolvedValue([]);
    expect(await suspendProviderVertical(VID, "paperwork")).toEqual({ ok: true });
    expect(serviceUpdateManyMock).not.toHaveBeenCalled();
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({
      data: { newValue: expect.objectContaining({ hiddenServiceIds: [] }) },
    });
  });

  it("reactivates ONLY a SUSPENDED vertical → APPROVED, clears suspendedAt, and does NOT republish any listing (no service writes)", async () => {
    existing("SUSPENDED");
    expect(await reactivateProviderVertical(VID)).toEqual({ ok: true });
    const upd = updateManyMock.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(upd.where).toEqual({ id: VID, status: { in: ["SUSPENDED"] } });
    expect(upd.data).toMatchObject({ status: "APPROVED", suspendedAt: null });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider_vertical.reactivated" } });
    // Reactivation touches only the vertical row — NO listing is auto-republished.
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(serviceFindManyMock).not.toHaveBeenCalled();
    expect(serviceUpdateManyMock).not.toHaveBeenCalled();
  });

  it("a concurrent loser (state-guarded updateMany matches 0 rows) → VERTICAL_STATE_CONFLICT, no audit", async () => {
    existing("PENDING_REVIEW");
    updateManyMock.mockResolvedValue({ count: 0 });
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_STATE_CONFLICT" });
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("every successful review action records exactly one audit event", async () => {
    existing("PENDING_REVIEW");
    await approveProviderVertical(VID);
    expect(auditCreateMock).toHaveBeenCalledTimes(1);
  });
});

describe("review-provider-vertical — approval policy + document compliance (Items 1 & 3)", () => {
  // A PENDING TOURIST_GUIDE vertical under review.
  function pendingTouristGuide() {
    findUniqueMock.mockResolvedValue({ status: "PENDING_REVIEW", vertical: "TOURIST_GUIDE", providerId: "provider-1" });
  }
  function requirement(
    key: string,
    opts: { appliesTo: string; required: boolean; active: boolean; evidenceExpires?: boolean }
  ) {
    return { key, appliesTo: opts.appliesTo, required: opts.required, active: opts.active, evidenceExpires: opts.evidenceExpires ?? false };
  }
  const REQ = (over: Partial<{ appliesTo: string; required: boolean; active: boolean; evidenceExpires: boolean }> = {}) =>
    requirement("TOURIST_GUIDE_LICENCE", { appliesTo: "TOURIST_GUIDE", required: true, active: true, ...over });
  const FUTURE = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const PAST = new Date(Date.now() - 24 * 3600 * 1000);

  beforeEach(() => pendingTouristGuide());

  // ---- Item 1: empty / optional-only / inactive-only / unreadable policy all FAIL CLOSED. ----
  it("Item 1 — EMPTY policy (zero required requirements) fails closed → VERTICAL_POLICY_NOT_CONFIGURED", async () => {
    requirementFindManyMock.mockResolvedValue([]);
    documentFindManyMock.mockResolvedValue([]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_POLICY_NOT_CONFIGURED" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("Item 1 — an OPTIONAL-only policy is NOT satisfied by zero required → VERTICAL_POLICY_NOT_CONFIGURED", async () => {
    requirementFindManyMock.mockResolvedValue([REQ({ required: false })]);
    documentFindManyMock.mockResolvedValue([]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_POLICY_NOT_CONFIGURED" });
  });

  it("Item 1 — an INACTIVE-only policy resolves to zero active required → VERTICAL_POLICY_NOT_CONFIGURED", async () => {
    requirementFindManyMock.mockResolvedValue([REQ({ active: false })]);
    documentFindManyMock.mockResolvedValue([]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_POLICY_NOT_CONFIGURED" });
  });

  it("Item 1 — a policy read error fails closed → VERTICAL_POLICY_NOT_CONFIGURED", async () => {
    requirementFindManyMock.mockRejectedValue(new Error("db down"));
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_POLICY_NOT_CONFIGURED" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("Item 1 — another vertical's requirement does NOT configure THIS one (audience isolation) → fails closed", async () => {
    requirementFindManyMock.mockResolvedValue([
      requirement("RENTAL_ACTIVITY_LICENCE", { appliesTo: "RENTAL_COMPANY", required: true, active: true }),
    ]);
    documentFindManyMock.mockResolvedValue([]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_POLICY_NOT_CONFIGURED" });
  });

  // ---- Document completeness (a configured, non-empty required policy). ----
  it("blocks approval when NO document exists for a required requirement → VERTICAL_DOCUMENTS_INCOMPLETE", async () => {
    requirementFindManyMock.mockResolvedValue([REQ()]);
    documentFindManyMock.mockResolvedValue([]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_DOCUMENTS_INCOMPLETE" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("blocks approval when ONE required document is missing (others present)", async () => {
    requirementFindManyMock.mockResolvedValue([
      REQ(),
      requirement("TOURIST_GUIDE_INSURANCE", { appliesTo: "TOURIST_GUIDE", required: true, active: true }),
    ]);
    documentFindManyMock.mockResolvedValue([{ type: "TOURIST_GUIDE_LICENCE", status: "APPROVED", expiresAt: null }]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_DOCUMENTS_INCOMPLETE" });
  });

  it("blocks approval when the required document is SUBMITTED but not yet approved (PENDING)", async () => {
    requirementFindManyMock.mockResolvedValue([REQ()]);
    documentFindManyMock.mockResolvedValue([{ type: "TOURIST_GUIDE_LICENCE", status: "PENDING", expiresAt: null }]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_DOCUMENTS_INCOMPLETE" });
  });

  it("blocks approval when the required document is REJECTED", async () => {
    requirementFindManyMock.mockResolvedValue([REQ()]);
    documentFindManyMock.mockResolvedValue([{ type: "TOURIST_GUIDE_LICENCE", status: "REJECTED", expiresAt: null }]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_DOCUMENTS_INCOMPLETE" });
  });

  it("APPROVES when every required (non-expiring) document exists and is APPROVED", async () => {
    requirementFindManyMock.mockResolvedValue([REQ()]);
    documentFindManyMock.mockResolvedValue([{ type: "TOURIST_GUIDE_LICENCE", status: "APPROVED", expiresAt: null }]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: true });
    expect(updateManyMock).toHaveBeenCalled();
  });

  // ---- Item 3: expiry enforcement for an expiring requirement. ----
  it("Item 3 — an EXPIRING requirement's approved doc with NO expiry blocks → VERTICAL_DOCUMENTS_INCOMPLETE", async () => {
    requirementFindManyMock.mockResolvedValue([REQ({ evidenceExpires: true })]);
    documentFindManyMock.mockResolvedValue([{ type: "TOURIST_GUIDE_LICENCE", status: "APPROVED", expiresAt: null }]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_DOCUMENTS_INCOMPLETE" });
  });

  it("Item 3 — an EXPIRING requirement's approved doc that has EXPIRED blocks", async () => {
    requirementFindManyMock.mockResolvedValue([REQ({ evidenceExpires: true })]);
    documentFindManyMock.mockResolvedValue([{ type: "TOURIST_GUIDE_LICENCE", status: "APPROVED", expiresAt: PAST }]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: false, error: "VERTICAL_DOCUMENTS_INCOMPLETE" });
  });

  it("Item 3 — APPROVES an expiring requirement whose approved doc has a FUTURE expiry", async () => {
    requirementFindManyMock.mockResolvedValue([REQ({ evidenceExpires: true })]);
    documentFindManyMock.mockResolvedValue([{ type: "TOURIST_GUIDE_LICENCE", status: "APPROVED", expiresAt: FUTURE }]);
    expect(await approveProviderVertical(VID)).toEqual({ ok: true });
    expect(updateManyMock).toHaveBeenCalled();
  });

  it("does NOT gate reject / request-changes on policy or documents (only APPROVED transitions do)", async () => {
    requirementFindManyMock.mockResolvedValue([]); // empty policy would block approval, but not these
    documentFindManyMock.mockResolvedValue([]);
    expect(await rejectProviderVertical(VID, "insufficient")).toEqual({ ok: true });
    pendingTouristGuide();
    expect(await requestProviderVerticalChanges(VID, "please add licence")).toEqual({ ok: true });
  });
});
