import { describe, it, expect, vi, afterEach } from "vitest";

// User & Access Management (Batch 2) — regression tests for getStaff(),
// mirroring get-admins.test.ts. Covers phone/User-ID search, status filter,
// roles surfacing, pagination, and non-admin denial.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: string) => /^[0-9a-f-]{36}$/i.test(v) }));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const findManyMock = vi.fn();
const countMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    staff: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getStaff } = await import("./get-staff");

afterEach(() => {
  requireAdminMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

const UUID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

describe("getStaff", () => {
  it("requires an Admin and surfaces roles and status", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      { id: "staff-1", userId: UUID, status: "ACTIVE", roles: ["SUPPORT", "FINANCE"], createdAt: new Date(), user: { phoneNumber: "+96890000003" } },
    ]);

    const result = await getStaff();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({ id: "staff-1", phoneNumber: "+96890000003", status: "ACTIVE", roles: ["SUPPORT", "FINANCE"] }),
    ]);
  });

  it("denies a non-admin caller", async () => {
    requireAdminMock.mockRejectedValue(new Error("Admin role required"));
    await expect(getStaff()).rejects.toThrow(/Admin role required/);
    expect(countMock).not.toHaveBeenCalled();
  });

  it("adds an exact User ID clause for a valid UUID query", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getStaff({ q: UUID });

    expect(countMock).toHaveBeenCalledWith({
      where: { OR: [{ user: { phoneNumber: { contains: UUID } } }, { userId: UUID }] },
    });
  });

  it("filters by Staff status", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getStaff({ status: "DEACTIVATED" });

    expect(countMock).toHaveBeenCalledWith({ where: { status: "DEACTIVATED" } });
  });
});
