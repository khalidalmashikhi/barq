import { describe, it, expect, vi, afterEach } from "vitest";

// User & Access Management (Batch 6) — regression tests for getStaffDetail().

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireAdmin: (...a: unknown[]) => requireAdminMock(...a) }));

const staffFindUniqueMock = vi.fn();
const sessionFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    staff: { findUnique: (...a: unknown[]) => staffFindUniqueMock(...a) },
    session: { findFirst: (...a: unknown[]) => sessionFindFirstMock(...a) },
  },
}));

const { getStaffDetail } = await import("./get-staff-detail");
const ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  requireAdminMock.mockReset();
  staffFindUniqueMock.mockReset();
  sessionFindFirstMock.mockReset();
});

describe("getStaffDetail", () => {
  it("denies a non-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new Error("Admin role required"));
    await expect(getStaffDetail(ID)).rejects.toThrow(/Admin role required/);
  });

  it("returns null for a missing staff member", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    staffFindUniqueMock.mockResolvedValue(null);
    expect(await getStaffDetail(ID)).toBeNull();
  });

  it("surfaces roles, status and derived last login", async () => {
    const login = new Date("2026-06-01T09:00:00Z");
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    staffFindUniqueMock.mockResolvedValue({ id: ID, userId: "user-1", status: "ACTIVE", roles: ["SUPPORT", "FINANCE"], createdAt: new Date(), user: { phoneNumber: "+96890000003", authUserId: "auth-1" } });
    sessionFindFirstMock.mockResolvedValue({ createdAt: login });

    const result = await getStaffDetail(ID);

    expect(result).toEqual(
      expect.objectContaining({ id: ID, phoneNumber: "+96890000003", status: "ACTIVE", roles: ["SUPPORT", "FINANCE"], lastLoginAt: login })
    );
  });
});
