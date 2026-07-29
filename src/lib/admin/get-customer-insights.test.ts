import { describe, it, expect, vi, afterEach } from "vitest";

// Admin Operations Platform — regression tests for
// getCustomersWithMostBookings()/getCustomersAwaitingReviews().

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const groupByMock = vi.fn();
const bookingFindManyMock = vi.fn();
const customerFindManyMock = vi.fn();
const customerCountMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      groupBy: (...args: unknown[]) => groupByMock(...args),
      findMany: (...args: unknown[]) => bookingFindManyMock(...args),
    },
    customer: {
      findMany: (...args: unknown[]) => customerFindManyMock(...args),
      count: (...args: unknown[]) => customerCountMock(...args),
    },
  },
}));

const { getCustomersWithMostBookings, getCustomersAwaitingReviews } = await import("./get-customer-insights");

afterEach(() => {
  requireAdminMock.mockReset();
  groupByMock.mockReset();
  bookingFindManyMock.mockReset();
  customerFindManyMock.mockReset();
  customerCountMock.mockReset();
});

describe("getCustomersWithMostBookings", () => {
  it("requires an Admin, ranks by booking count via one groupBy, and joins phone numbers in a single follow-up query", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    groupByMock.mockResolvedValue([
      { customerId: "customer-1", _count: 5 },
      { customerId: "customer-2", _count: 2 },
    ]);
    customerFindManyMock.mockResolvedValue([
      { id: "customer-1", user: { phoneNumber: "+96890000001" } },
      { id: "customer-2", user: { phoneNumber: "+96890000002" } },
    ]);

    const result = await getCustomersWithMostBookings();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(groupByMock).toHaveBeenCalledTimes(1);
    expect(customerFindManyMock).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([
      { id: "customer-1", phoneNumber: "+96890000001", bookingCount: 5 },
      { id: "customer-2", phoneNumber: "+96890000002", bookingCount: 2 },
    ]);
  });

  it("returns an empty list without a follow-up query when there are no bookings", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    groupByMock.mockResolvedValue([]);

    const result = await getCustomersWithMostBookings();

    expect(result.items).toEqual([]);
    expect(customerFindManyMock).not.toHaveBeenCalled();
  });
});

describe("getCustomersAwaitingReviews", () => {
  it("reuses the exact COMPLETED + review:null eligibility rule via a `some` relation filter", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    customerCountMock.mockResolvedValue(1);
    customerFindManyMock.mockResolvedValue([{ id: "customer-1", user: { phoneNumber: "+96890000001" } }]);

    await getCustomersAwaitingReviews();

    const expectedWhere = { bookings: { some: { status: "COMPLETED", review: null } } };
    expect(customerCountMock).toHaveBeenCalledWith({ where: expectedWhere });
    expect(customerFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
  });

  it("returns the real count and a bounded preview", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    customerCountMock.mockResolvedValue(7);
    customerFindManyMock.mockResolvedValue([{ id: "customer-1", user: { phoneNumber: "+96890000001" } }]);

    const result = await getCustomersAwaitingReviews();

    expect(result.count).toBe(7);
    expect(result.items).toEqual([{ id: "customer-1", phoneNumber: "+96890000001" }]);
  });
});
