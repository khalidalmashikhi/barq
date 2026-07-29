import { describe, it, expect, vi, afterEach } from "vitest";

// UX remediation (Admin navigation entry) — regression tests for
// hasActiveAdminProfile(): the non-throwing companion to requireAdmin()
// that dashboard/page.tsx uses to decide whether to show the "Admin
// Panel" nav item. Mirrors requireAdmin()'s own prisma.admin.findUnique
// call exactly, so these tests mock the same shape.
//
// Production Blocker fix — added requireProvider() coverage: previously
// this function only checked that a Provider row existed, never its
// status, so a DEACTIVATED provider retained full operational access
// (accept/reject/start/complete bookings, payment views) for as long
// as their session stayed valid. These tests prove the new status
// check rejects DEACTIVATED/SUSPENDED while leaving every other status
// (including pre-approval ones, which this function has never gated —
// that's requireApprovedProvider()'s separate job) unaffected.

vi.mock("server-only", () => ({}));

const adminFindUniqueMock = vi.fn();
const providerFindUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    admin: {
      findUnique: (...args: unknown[]) => adminFindUniqueMock(...args),
    },
    provider: {
      findUnique: (...args: unknown[]) => providerFindUniqueMock(...args),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

const getSessionMock = vi.fn();
vi.mock("./session", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

const resolveBarqUserMock = vi.fn();
vi.mock("./barq-user", () => ({
  resolveBarqUser: (...args: unknown[]) => resolveBarqUserMock(...args),
}));

const { hasActiveAdminProfile, requireProvider } = await import("./rbac");
const { ForbiddenError } = await import("./errors");

const USER_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  adminFindUniqueMock.mockReset();
  providerFindUniqueMock.mockReset();
  getSessionMock.mockReset();
  resolveBarqUserMock.mockReset();
});

describe("hasActiveAdminProfile", () => {
  it("returns true for a user with an ACTIVE Admin row", async () => {
    adminFindUniqueMock.mockResolvedValue({ id: "admin-1", userId: USER_ID, status: "ACTIVE" });

    const result = await hasActiveAdminProfile(USER_ID);

    expect(result).toBe(true);
    expect(adminFindUniqueMock).toHaveBeenCalledWith({ where: { userId: USER_ID } });
  });

  it("returns false when no Admin row exists for the user", async () => {
    adminFindUniqueMock.mockResolvedValue(null);

    const result = await hasActiveAdminProfile(USER_ID);

    expect(result).toBe(false);
  });

  it("returns false for a DEACTIVATED Admin row — not just 'exists'", async () => {
    adminFindUniqueMock.mockResolvedValue({ id: "admin-1", userId: USER_ID, status: "DEACTIVATED" });

    const result = await hasActiveAdminProfile(USER_ID);

    expect(result).toBe(false);
  });

  it("never throws — a UI-visibility check, not an authorization gate", async () => {
    adminFindUniqueMock.mockResolvedValue(null);

    await expect(hasActiveAdminProfile(USER_ID)).resolves.toBe(false);
  });
});

describe("requireProvider (Production Blocker fix)", () => {
  function mockAuthenticatedAs(userId: string) {
    getSessionMock.mockResolvedValue({ user: { id: userId } });
    resolveBarqUserMock.mockResolvedValue({ id: userId });
  }

  it("throws ForbiddenError with code PROVIDER_DEACTIVATED for a DEACTIVATED provider", async () => {
    mockAuthenticatedAs(USER_ID);
    providerFindUniqueMock.mockResolvedValue({ id: "provider-1", userId: USER_ID, status: "DEACTIVATED" });

    const error = await requireProvider().catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as InstanceType<typeof ForbiddenError>).code).toBe("PROVIDER_DEACTIVATED");
  });

  it("throws ForbiddenError with code PROVIDER_DEACTIVATED for a SUSPENDED provider", async () => {
    mockAuthenticatedAs(USER_ID);
    providerFindUniqueMock.mockResolvedValue({ id: "provider-1", userId: USER_ID, status: "SUSPENDED" });

    const error = await requireProvider().catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as InstanceType<typeof ForbiddenError>).code).toBe("PROVIDER_DEACTIVATED");
  });

  it("does NOT throw for an APPROVED provider — the real, common case is unaffected", async () => {
    mockAuthenticatedAs(USER_ID);
    providerFindUniqueMock.mockResolvedValue({ id: "provider-1", userId: USER_ID, status: "APPROVED" });

    const result = await requireProvider();

    expect(result.provider.status).toBe("APPROVED");
  });

  it.each(["APPLIED", "UNDER_REVIEW", "REJECTED"])(
    "does NOT throw for a %s provider — pre-approval statuses remain requireApprovedProvider()'s job, not this function's",
    async (status) => {
      mockAuthenticatedAs(USER_ID);
      providerFindUniqueMock.mockResolvedValue({ id: "provider-1", userId: USER_ID, status });

      const result = await requireProvider();

      expect(result.provider.status).toBe(status);
    }
  );

  it("still throws a plain ForbiddenError (no code) when no Provider row exists at all", async () => {
    mockAuthenticatedAs(USER_ID);
    providerFindUniqueMock.mockResolvedValue(null);

    const error = await requireProvider().catch((e) => e);

    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as InstanceType<typeof ForbiddenError>).code).toBeUndefined();
  });
});
