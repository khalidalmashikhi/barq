import { describe, it, expect, vi, afterEach } from "vitest";

// Admin Operations Platform — regression test for getCustomers(),
// mirroring get-providers.test.ts's shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getCustomers } = await import("./get-customers");

afterEach(() => {
  requireAdminMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getCustomers", () => {
  it("requires an Admin and returns a paginated result with real relation counts, never a fabricated bookingCount/reviewCount", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "customer-1",
        createdAt: new Date(),
        user: { phoneNumber: "+96890000001" },
        _count: { bookings: 4, reviews: 2 },
      },
    ]);

    const result = await getCustomers();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({ id: "customer-1", phoneNumber: "+96890000001", bookingCount: 4, reviewCount: 2 }),
    ]);
  });

  it("filters by phone number search when provided", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getCustomers({ q: "9000" });

    expect(countMock).toHaveBeenCalledWith({ where: { user: { phoneNumber: { contains: "9000" } } } });
  });

  it("computes pagination fields correctly across pages", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    countMock.mockResolvedValue(45);
    findManyMock.mockResolvedValue([]);

    const result = await getCustomers({ page: 2, pageSize: 20 });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(20);
    expect(result.totalPages).toBe(3);
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 20 }));
  });
});
