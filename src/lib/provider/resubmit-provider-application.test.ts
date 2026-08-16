import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Review / Reject / Resubmit — resubmitProviderApplication() domain
// tests. A provider self-action: identity comes ONLY from requireProvider()
// (own provider, never a URL id). Proves: REJECTED → DRAFT with the rejection
// fields cleared, the optimistic conditional guard (updateMany WHERE status =
// REJECTED), the provider.resubmitted audit (PROVIDER actor), and that a
// non-rejected / stale / non-provider caller is refused with NOT_REJECTED.

vi.mock("server-only", () => ({}));

// Shared error classes so `instanceof ForbiddenError` inside the SUT matches
// what the test throws (vi.hoisted runs before the mock factory).
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

const { resubmitProviderApplication } = await import("./resubmit-provider-application");

afterEach(() => {
  requireProviderMock.mockReset();
  updateManyMock.mockReset();
  auditCreateMock.mockReset();
});

describe("resubmitProviderApplication", () => {
  it("own REJECTED provider → DRAFT: clears rejection fields, records provider.resubmitted audit", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "prov-1" } });
    updateManyMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});

    const result = await resubmitProviderApplication();

    expect(result).toEqual({ ok: true });

    // Scoped to THIS provider (own id from auth) and only if still REJECTED.
    const updateArg = updateManyMock.mock.calls[0]![0] as {
      where: { id: string; status: string };
      data: { status: string; rejectionReason: null; rejectedAt: null; rejectedByAdminId: null };
    };
    expect(updateArg.where).toEqual({ id: "prov-1", status: "REJECTED" });
    expect(updateArg.data.status).toBe("DRAFT");
    expect(updateArg.data.rejectionReason).toBeNull();
    expect(updateArg.data.rejectedAt).toBeNull();
    expect(updateArg.data.rejectedByAdminId).toBeNull();

    const auditArg = auditCreateMock.mock.calls[0]![0] as {
      data: { actorType: string; actorId: string; action: string; previousValue: unknown; newValue: unknown };
    };
    expect(auditArg.data.actorType).toBe("PROVIDER");
    expect(auditArg.data.actorId).toBe("prov-1");
    expect(auditArg.data.action).toBe("provider.resubmitted");
    expect(auditArg.data.previousValue).toEqual({ status: "REJECTED" });
    expect(auditArg.data.newValue).toEqual({ status: "DRAFT" });
  });

  it("uses the authenticated provider's own id — never a caller-supplied id (no id parameter exists)", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "prov-OWN" } });
    updateManyMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});

    await resubmitProviderApplication();
    const updateArg = updateManyMock.mock.calls[0]![0] as { where: { id: string } };
    expect(updateArg.where.id).toBe("prov-OWN");
  });

  it("APPLIED/APPROVED (not REJECTED) cannot resubmit — conditional update matches 0 rows → NOT_REJECTED", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "prov-1" } });
    updateManyMock.mockResolvedValue({ count: 0 });

    const result = await resubmitProviderApplication();
    expect(result).toEqual({ ok: false, error: "NOT_REJECTED" });
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("stale/concurrent transition (admin changed status meanwhile) → NOT_REJECTED", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "prov-1" } });
    updateManyMock.mockResolvedValue({ count: 0 });
    expect(await resubmitProviderApplication()).toEqual({ ok: false, error: "NOT_REJECTED" });
  });

  it("a non-provider / SUSPENDED / DEACTIVATED caller (requireProvider throws Forbidden) → NOT_REJECTED", async () => {
    requireProviderMock.mockRejectedValue(new ForbiddenError());
    const result = await resubmitProviderApplication();
    expect(result).toEqual({ ok: false, error: "NOT_REJECTED" });
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
