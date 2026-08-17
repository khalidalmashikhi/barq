import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const updateManyMock = vi.fn();
const auditCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        provider: { updateMany: (...a: unknown[]) => updateManyMock(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));

const assertReadyToSubmitMock = vi.fn();
vi.mock("./documents/assert-ready-to-submit", () => ({
  assertReadyToSubmit: (...a: unknown[]) => assertReadyToSubmitMock(...a),
}));

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

// Gate B2 — the admin fan-out is dispatched through this module; mocked so the
// idempotency contract (fires on a REAL transition only) can be asserted directly.
const notifyAdminsMock = vi.fn();
vi.mock("@/lib/notifications/provider-notification-events", () => ({
  PROVIDER_NOTIFICATION_EVENT: {
    VERIFICATION_SUBMITTED: "provider.verification_submitted",
    CHANGES_RESUBMITTED: "provider.changes_resubmitted",
  },
  notifyAdminsOfProviderEvent: (...a: unknown[]) => notifyAdminsMock(...a),
}));

const { submitProviderVerification } = await import("./submit-provider-verification");

beforeEach(() => {
  requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "DRAFT", providerType: "INDIVIDUAL" } });
  assertReadyToSubmitMock.mockResolvedValue([]);
  updateManyMock.mockResolvedValue({ count: 1 });
  auditCreateMock.mockResolvedValue({});
  notifyAdminsMock.mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe("submitProviderVerification", () => {
  it("DRAFT + ready → UNDER_REVIEW, sets submittedAt, clears reason, records audit (optimistic guard on editable states)", async () => {
    const result = await submitProviderVerification();
    expect(result).toEqual({ ok: true, status: "UNDER_REVIEW", alreadySubmitted: false });

    const arg = updateManyMock.mock.calls[0]![0] as {
      where: { id: string; status: { in: string[] } };
      data: { status: string; submittedAt: unknown; rejectionReason: null };
    };
    // Guarded on the editable states only — legacy APPLIED can never be moved by this.
    expect(arg.where).toEqual({ id: "prov-1", status: { in: ["DRAFT", "CHANGES_REQUESTED"] } });
    expect(arg.data.status).toBe("UNDER_REVIEW");
    expect(arg.data.submittedAt).toBeInstanceOf(Date);
    expect(arg.data.rejectionReason).toBeNull(); // clears any prior changes-request reason

    const audit = auditCreateMock.mock.calls[0]![0] as {
      data: { action: string; actorType: string; previousValue: unknown; newValue: unknown };
    };
    expect(audit.data.action).toBe("provider.verification_submitted");
    expect(audit.data.actorType).toBe("PROVIDER");
    expect(audit.data.previousValue).toEqual({ status: "DRAFT" });
    expect(audit.data.newValue).toEqual({ status: "UNDER_REVIEW" });

    // Gate B2 — DRAFT -> UNDER_REVIEW fans out provider.verification_submitted.
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
    expect(notifyAdminsMock).toHaveBeenCalledWith("provider.verification_submitted", { providerId: "prov-1" });
  });

  it("CHANGES_REQUESTED + ready → UNDER_REVIEW (re-submit), audits with the correct previous status", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "CHANGES_REQUESTED", providerType: "INDIVIDUAL" } });
    const result = await submitProviderVerification();
    expect(result).toEqual({ ok: true, status: "UNDER_REVIEW", alreadySubmitted: false });
    const audit = auditCreateMock.mock.calls[0]![0] as { data: { previousValue: unknown } };
    expect(audit.data.previousValue).toEqual({ status: "CHANGES_REQUESTED" });

    // Gate B2 — a CHANGES_REQUESTED re-submit fans out the DISTINCT event.
    expect(notifyAdminsMock).toHaveBeenCalledTimes(1);
    expect(notifyAdminsMock).toHaveBeenCalledWith("provider.changes_resubmitted", { providerId: "prov-1" });
  });

  it("blocks submission when a required document is missing (NOT_READY) and writes nothing", async () => {
    assertReadyToSubmitMock.mockResolvedValue([{ type: "IDENTITY_PROOF", reason: "MISSING" }]);
    const result = await submitProviderVerification();
    expect(result).toEqual({ ok: false, error: "NOT_READY", blockers: [{ type: "IDENTITY_PROOF", reason: "MISSING" }] });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
    expect(notifyAdminsMock).not.toHaveBeenCalled();
  });

  it("is idempotent: an already-UNDER_REVIEW provider returns success (no re-transition, no audit)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "UNDER_REVIEW", providerType: "INDIVIDUAL" } });
    const result = await submitProviderVerification();
    expect(result).toEqual({ ok: true, status: "UNDER_REVIEW", alreadySubmitted: true });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
    // Idempotency: no transition -> no notification.
    expect(notifyAdminsMock).not.toHaveBeenCalled();
  });

  it.each(["APPROVED", "REJECTED", "APPLIED", "SUSPENDED"])(
    "rejects submission from non-DRAFT state %s with INVALID_STATE (legacy APPLIED is never submittable here)",
    async (status) => {
      requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status, providerType: "INDIVIDUAL" } });
      const result = await submitProviderVerification();
      expect(result).toEqual({ ok: false, error: "INVALID_STATE" });
      expect(updateManyMock).not.toHaveBeenCalled();
    }
  );

  it("maps a non-provider caller to NO_PROVIDER_PROFILE", async () => {
    requireProviderMock.mockRejectedValue(new ForbiddenError());
    const result = await submitProviderVerification();
    expect(result).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });
  });

  it("propagates UnauthenticatedError so the transport can redirect to login", async () => {
    requireProviderMock.mockRejectedValue(new UnauthenticatedError());
    await expect(submitProviderVerification()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("concurrency: a lost optimistic race (updateMany count 0) is an idempotent success, not a second audit", async () => {
    updateManyMock.mockResolvedValue({ count: 0 }); // a concurrent submit already left DRAFT
    const result = await submitProviderVerification();
    expect(result).toEqual({ ok: true, status: "UNDER_REVIEW", alreadySubmitted: true });
    expect(auditCreateMock).not.toHaveBeenCalled();
    // Idempotency: a lost race performed no transition -> no notification.
    expect(notifyAdminsMock).not.toHaveBeenCalled();
  });
});
