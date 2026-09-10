import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 3B — Phase 1. Provider self-service request of a regulated vertical. A first request creates
// a PENDING_REVIEW row (origin PROVIDER_REQUEST); a duplicate request is safe (no error, no second
// row); a CHANGES_REQUESTED / REJECTED vertical can be resubmitted back to PENDING_REVIEW; a request
// NEVER approves (approval is admin-only). Every mutation writes an actor-attributed audit event.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {
    code?: string;
  },
}));

const findUniqueMock = vi.fn();
const createMock = vi.fn();
const updateManyMock = vi.fn();
const auditCreateMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    providerVertical: { findUnique: (...a: unknown[]) => findUniqueMock(...a) },
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        providerVertical: {
          create: (...a: unknown[]) => createMock(...a),
          updateMany: (...a: unknown[]) => updateManyMock(...a),
        },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const { requestProviderVertical } = await import("./request-vertical");

beforeEach(() => {
  // Onboarding-eligible by default (APPROVED). Specific tests override the account status.
  requireProviderMock.mockResolvedValue({ provider: { id: "provider-1", status: "APPROVED" } });
  createMock.mockResolvedValue({ id: "vertical-1" });
  updateManyMock.mockResolvedValue({ count: 1 });
  auditCreateMock.mockResolvedValue({});
});
afterEach(() => vi.clearAllMocks());

describe("requestProviderVertical", () => {
  it("rejects an unknown vertical value without touching the DB", async () => {
    const result = await requestProviderVertical("NOT_A_VERTICAL");
    expect(result).toEqual({ ok: false, error: "INVALID_VERTICAL" });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("Blocker 2 — a provider ONBOARDING (UNDER_REVIEW, not yet APPROVED) may request a vertical", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1", status: "UNDER_REVIEW" } });
    findUniqueMock.mockResolvedValue(null);
    const result = await requestProviderVertical("TOURIST_GUIDE");
    expect(result).toEqual({ ok: true, outcome: "requested" });
    expect(createMock).toHaveBeenCalled();
  });

  it("Blocker 2 — every eligible onboarding state (DRAFT/APPLIED/UNDER_REVIEW/CHANGES_REQUESTED/APPROVED) may request", async () => {
    for (const status of ["DRAFT", "APPLIED", "UNDER_REVIEW", "CHANGES_REQUESTED", "APPROVED"]) {
      requireProviderMock.mockResolvedValue({ provider: { id: "provider-1", status } });
      findUniqueMock.mockResolvedValue(null);
      createMock.mockResolvedValue({ id: "v" });
      expect(await requestProviderVertical("RENTAL_COMPANY")).toEqual({ ok: true, outcome: "requested" });
    }
  });

  it("Blocker 2 — a REJECTED provider account CANNOT request → PROVIDER_NOT_ELIGIBLE (no DB read)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1", status: "REJECTED" } });
    expect(await requestProviderVertical("RENTAL_COMPANY")).toEqual({ ok: false, error: "PROVIDER_NOT_ELIGIBLE" });
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("Blocker 2 — a SUSPENDED/DEACTIVATED account (requireProvider throws PROVIDER_DEACTIVATED) → PROVIDER_NOT_ELIGIBLE", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    const ferr = new ForbiddenError("deactivated");
    (ferr as unknown as { code?: string }).code = "PROVIDER_DEACTIVATED";
    requireProviderMock.mockRejectedValue(ferr);
    expect(await requestProviderVertical("RENTAL_COMPANY")).toEqual({ ok: false, error: "PROVIDER_NOT_ELIGIBLE" });
  });

  it("Blocker 2 — a missing provider profile (ForbiddenError, no code) → NO_PROVIDER_PROFILE", async () => {
    const { ForbiddenError } = await import("@/lib/auth");
    requireProviderMock.mockRejectedValue(new ForbiddenError("no provider"));
    expect(await requestProviderVertical("RENTAL_COMPANY")).toEqual({ ok: false, error: "NO_PROVIDER_PROFILE" });
  });

  it("creates a PENDING_REVIEW row (origin PROVIDER_REQUEST) for a first-time TOURIST_GUIDE request + audits", async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await requestProviderVertical("TOURIST_GUIDE");
    expect(result).toEqual({ ok: true, outcome: "requested" });
    expect(createMock).toHaveBeenCalledWith({
      data: { providerId: "provider-1", vertical: "TOURIST_GUIDE", status: "PENDING_REVIEW", origin: "PROVIDER_REQUEST" },
    });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({
      data: { action: "provider_vertical.requested", actorType: "PROVIDER", actorId: "provider-1" },
    });
  });

  it("creates a RENTAL_COMPANY request the same way", async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await requestProviderVertical("RENTAL_COMPANY");
    expect(result).toEqual({ ok: true, outcome: "requested" });
    expect(createMock.mock.calls[0]![0].data.vertical).toBe("RENTAL_COMPANY");
  });

  it("is idempotent: an already-PENDING request returns already_pending without a second write", async () => {
    findUniqueMock.mockResolvedValue({ id: "v1", status: "PENDING_REVIEW" });
    const result = await requestProviderVertical("RENTAL_COMPANY");
    expect(result).toEqual({ ok: true, outcome: "already_pending" });
    expect(createMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("refuses to re-request an already APPROVED vertical → VERTICAL_ALREADY_EXISTS", async () => {
    findUniqueMock.mockResolvedValue({ id: "v1", status: "APPROVED" });
    expect(await requestProviderVertical("RENTAL_COMPANY")).toEqual({ ok: false, error: "VERTICAL_ALREADY_EXISTS" });
  });

  it("refuses to re-request a SUSPENDED vertical → VERTICAL_REJECTED_OR_SUSPENDED (admin must reactivate)", async () => {
    findUniqueMock.mockResolvedValue({ id: "v1", status: "SUSPENDED" });
    expect(await requestProviderVertical("RENTAL_COMPANY")).toEqual({
      ok: false,
      error: "VERTICAL_REJECTED_OR_SUSPENDED",
    });
  });

  it("resubmits a CHANGES_REQUESTED vertical back to PENDING_REVIEW (state-guarded) + audits", async () => {
    findUniqueMock.mockResolvedValue({ id: "v1", status: "CHANGES_REQUESTED" });
    const result = await requestProviderVertical("RENTAL_COMPANY");
    expect(result).toEqual({ ok: true, outcome: "resubmitted" });
    const upd = updateManyMock.mock.calls[0]![0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(upd.where).toEqual({ id: "v1", status: { in: ["CHANGES_REQUESTED", "REJECTED"] } });
    expect(upd.data).toMatchObject({ status: "PENDING_REVIEW", reason: null, reviewedByAdminId: null });
    expect(auditCreateMock.mock.calls[0]![0]).toMatchObject({ data: { action: "provider_vertical.resubmitted" } });
  });

  it("resubmits a REJECTED vertical back to PENDING_REVIEW", async () => {
    findUniqueMock.mockResolvedValue({ id: "v1", status: "REJECTED" });
    expect(await requestProviderVertical("TOURIST_GUIDE")).toEqual({ ok: true, outcome: "resubmitted" });
  });

  it("resubmission that loses the state-guard (concurrent admin decision) degrades to already_pending", async () => {
    findUniqueMock.mockResolvedValue({ id: "v1", status: "CHANGES_REQUESTED" });
    updateManyMock.mockResolvedValue({ count: 0 });
    expect(await requestProviderVertical("RENTAL_COMPANY")).toEqual({ ok: true, outcome: "already_pending" });
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("treats a P2002 unique-race on first create as already_pending (concurrent duplicate request)", async () => {
    findUniqueMock.mockResolvedValue(null);
    createMock.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    expect(await requestProviderVertical("RENTAL_COMPANY")).toEqual({ ok: true, outcome: "already_pending" });
  });
});
