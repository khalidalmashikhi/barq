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
const staffFindUniqueMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    admin: {
      findUnique: (...args: unknown[]) => adminFindUniqueMock(...args),
    },
    provider: {
      findUnique: (...args: unknown[]) => providerFindUniqueMock(...args),
    },
    staff: {
      findUnique: (...args: unknown[]) => staffFindUniqueMock(...args),
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

const { hasActiveAdminProfile, hasApprovedProviderProfile, requireProvider, requireAuth, requireAdmin, requireStaff } = await import("./rbac");
const { ForbiddenError, UnauthenticatedError } = await import("./errors");

const USER_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  adminFindUniqueMock.mockReset();
  providerFindUniqueMock.mockReset();
  staffFindUniqueMock.mockReset();
  getSessionMock.mockReset();
  resolveBarqUserMock.mockReset();
});

// User & Access Management (Batch 1) — status-based authorization: a
// SUSPENDED/DEACTIVATED user, a non-ACTIVE Admin, and a non-ACTIVE Staff must
// all be denied access, since a valid Better Auth session outlives the
// deactivation. These prove the new checks reject inactive accounts while
// leaving normal (CREATED/VERIFIED/ACTIVE) accounts unaffected.

function mockAuthenticatedWithStatus(status: string | undefined) {
  getSessionMock.mockResolvedValue({ user: { id: USER_ID } });
  resolveBarqUserMock.mockResolvedValue({ id: USER_ID, status });
}

describe("requireAuth — user status gate", () => {
  it("throws UnauthenticatedError when there is no session", async () => {
    getSessionMock.mockResolvedValue(null);
    const error = await requireAuth().catch((e) => e);
    expect(error).toBeInstanceOf(UnauthenticatedError);
  });

  it.each(["SUSPENDED", "DEACTIVATED"])(
    "throws ForbiddenError with code USER_INACTIVE for a %s user",
    async (status) => {
      mockAuthenticatedWithStatus(status);
      const error = await requireAuth().catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as InstanceType<typeof ForbiddenError>).code).toBe("USER_INACTIVE");
    }
  );

  it.each(["CREATED", "VERIFIED", "ACTIVE"])(
    "allows a %s user — the denylist never blocks a normal account",
    async (status) => {
      mockAuthenticatedWithStatus(status);
      const ctx = await requireAuth();
      expect(ctx.barqUser.id).toBe(USER_ID);
    }
  );
});

describe("requireAdmin — active-admin gate", () => {
  it("returns for an ACTIVE admin", async () => {
    mockAuthenticatedWithStatus("ACTIVE");
    adminFindUniqueMock.mockResolvedValue({ id: "admin-1", userId: USER_ID, status: "ACTIVE" });
    const { admin } = await requireAdmin();
    expect(admin.status).toBe("ACTIVE");
  });

  it("throws ForbiddenError for a DEACTIVATED admin — deactivation actually revokes access", async () => {
    mockAuthenticatedWithStatus("ACTIVE");
    adminFindUniqueMock.mockResolvedValue({ id: "admin-1", userId: USER_ID, status: "DEACTIVATED" });
    const error = await requireAdmin().catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when no admin row exists", async () => {
    mockAuthenticatedWithStatus("ACTIVE");
    adminFindUniqueMock.mockResolvedValue(null);
    const error = await requireAdmin().catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
  });
});

describe("requireStaff — active-staff gate", () => {
  it("returns for an ACTIVE staff member and enforces role membership", async () => {
    mockAuthenticatedWithStatus("ACTIVE");
    staffFindUniqueMock.mockResolvedValue({ id: "staff-1", userId: USER_ID, status: "ACTIVE", roles: ["SUPPORT"] });
    const { staff } = await requireStaff("SUPPORT");
    expect(staff.status).toBe("ACTIVE");
  });

  it("throws ForbiddenError for a DEACTIVATED staff member", async () => {
    mockAuthenticatedWithStatus("ACTIVE");
    staffFindUniqueMock.mockResolvedValue({ id: "staff-1", userId: USER_ID, status: "DEACTIVATED", roles: ["SUPPORT"] });
    const error = await requireStaff().catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
  });

  it("throws ForbiddenError when the required role is missing, even for ACTIVE staff", async () => {
    mockAuthenticatedWithStatus("ACTIVE");
    staffFindUniqueMock.mockResolvedValue({ id: "staff-1", userId: USER_ID, status: "ACTIVE", roles: ["SUPPORT"] });
    const error = await requireStaff("FINANCE").catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenError);
  });
});

describe("hasApprovedProviderProfile", () => {
  it("returns true only for a Provider row with status APPROVED", async () => {
    providerFindUniqueMock.mockResolvedValue({ status: "APPROVED" });
    expect(await hasApprovedProviderProfile(USER_ID)).toBe(true);
  });

  it("returns false when the user has no Provider row", async () => {
    providerFindUniqueMock.mockResolvedValue(null);
    expect(await hasApprovedProviderProfile(USER_ID)).toBe(false);
  });

  it("returns false for a non-APPROVED provider status (e.g. APPLIED)", async () => {
    providerFindUniqueMock.mockResolvedValue({ status: "APPLIED" });
    expect(await hasApprovedProviderProfile(USER_ID)).toBe(false);
  });
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
