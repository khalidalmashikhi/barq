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

const { submitProviderVerification } = await import("./submit-provider-verification");

beforeEach(() => {
  requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "DRAFT", providerType: "INDIVIDUAL" } });
  assertReadyToSubmitMock.mockResolvedValue([]);
  updateManyMock.mockResolvedValue({ count: 1 });
  auditCreateMock.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe("submitProviderVerification", () => {
  it("DRAFT + ready → UNDER_REVIEW, sets submittedAt, records audit (optimistic guard on status='DRAFT')", async () => {
    const result = await submitProviderVerification();
    expect(result).toEqual({ ok: true, status: "UNDER_REVIEW", alreadySubmitted: false });

    const arg = updateManyMock.mock.calls[0]![0] as {
      where: { id: string; status: string };
      data: { status: string; submittedAt: unknown };
    };
    expect(arg.where).toEqual({ id: "prov-1", status: "DRAFT" }); // legacy APPLIED can never be moved by this
    expect(arg.data.status).toBe("UNDER_REVIEW");
    expect(arg.data.submittedAt).toBeInstanceOf(Date);

    const audit = auditCreateMock.mock.calls[0]![0] as {
      data: { action: string; actorType: string; previousValue: unknown; newValue: unknown };
    };
    expect(audit.data.action).toBe("provider.verification_submitted");
    expect(audit.data.actorType).toBe("PROVIDER");
    expect(audit.data.previousValue).toEqual({ status: "DRAFT" });
    expect(audit.data.newValue).toEqual({ status: "UNDER_REVIEW" });
  });

  it("blocks submission when a required document is missing (NOT_READY) and writes nothing", async () => {
    assertReadyToSubmitMock.mockResolvedValue([{ type: "IDENTITY_PROOF", reason: "MISSING" }]);
    const result = await submitProviderVerification();
    expect(result).toEqual({ ok: false, error: "NOT_READY", blockers: [{ type: "IDENTITY_PROOF", reason: "MISSING" }] });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("is idempotent: an already-UNDER_REVIEW provider returns success (no re-transition, no audit)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "prov-1", status: "UNDER_REVIEW", providerType: "INDIVIDUAL" } });
    const result = await submitProviderVerification();
    expect(result).toEqual({ ok: true, status: "UNDER_REVIEW", alreadySubmitted: true });
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
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
  });
});
