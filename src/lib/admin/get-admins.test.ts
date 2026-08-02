import { describe, it, expect, vi, afterEach } from "vitest";

// User & Access Management (Batch 2) — regression tests for getAdmins(),
// mirroring get-customers.test.ts's shape. Covers phone/User-ID search, the
// status filter, pagination, and that a non-admin caller is denied.

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
    admin: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getAdmins } = await import("./get-admins");

afterEach(() => {
  requireAdminMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

const UUID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

describe("getAdmins", () => {
  it("requires an Admin and returns a paginated result surfacing phone/status", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      { id: "admin-1", userId: UUID, status: "ACTIVE", createdAt: new Date(), user: { phoneNumber: "+96890000001" } },
    ]);

    const result = await getAdmins();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({ id: "admin-1", userId: UUID, phoneNumber: "+96890000001", status: "ACTIVE" }),
    ]);
  });

  it("denies a non-admin caller — requireAdmin's rejection propagates", async () => {
    requireAdminMock.mockRejectedValue(new Error("Admin role required"));
    await expect(getAdmins()).rejects.toThrow(/Admin role required/);
    expect(countMock).not.toHaveBeenCalled();
  });

  it("searches by phone (contains) for a non-UUID query", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getAdmins({ q: "9000" });

    expect(countMock).toHaveBeenCalledWith({ where: { user: { phoneNumber: { contains: "9000" } } } });
  });

  it("adds an exact User ID clause for a valid UUID query", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getAdmins({ q: UUID });

    expect(countMock).toHaveBeenCalledWith({
      where: { OR: [{ user: { phoneNumber: { contains: UUID } } }, { userId: UUID }] },
    });
  });

  it("filters by Admin status and combines with search under AND", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getAdmins({ status: "DEACTIVATED", q: "9000" });

    expect(countMock).toHaveBeenCalledWith({
      where: { AND: [{ status: "DEACTIVATED" }, { user: { phoneNumber: { contains: "9000" } } }] },
    });
  });

  it("computes pagination fields correctly across pages", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(45);
    findManyMock.mockResolvedValue([]);

    const result = await getAdmins({ page: 2, pageSize: 20 });

    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(3);
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
  });
});
