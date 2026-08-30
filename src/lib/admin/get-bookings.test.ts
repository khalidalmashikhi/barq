import { describe, it, expect, vi, afterEach } from "vitest";

// Phase 2.9 (Booking Foundation) — regression test for getBookings(),
// mirroring get-prices.test.ts's/get-availability-slots.test.ts's shape.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const getLocaleMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const findManyMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

const { getBookings } = await import("./get-bookings");

afterEach(() => {
  requireAdminMock.mockReset();
  getLocaleMock.mockReset();
  findManyMock.mockReset();
  countMock.mockReset();
});

describe("getBookings", () => {
  it("requires an Admin and returns a paginated result", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "booking-1",
        customerId: "customer-1",
        serviceId: "service-1",
        providerId: "provider-1",
        status: "CONFIRMED",
        seats: 2,
        priceSnapshotAmount: "25.00",
        priceSnapshotCurrency: "OMR",
        createdAt: new Date(),
        service: { name: { ar: "جولة", en: "Desert Tour" } },
        provider: { businessName: { ar: "مزود", en: "Desert Co" } },
        availability: { startTime: new Date("2026-08-01T10:00:00Z") },
      },
    ]);

    const result = await getBookings();

    expect(requireAdminMock).toHaveBeenCalled();
    expect(result.totalCount).toBe(1);
    expect(result.page).toBe(1);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "booking-1",
        customerId: "customer-1",
        serviceName: "Desert Tour",
        providerName: "Desert Co",
        status: "CONFIRMED",
        seats: 2,
        priceSnapshot: "25.00 OMR",
      }),
    ]);
  });

  it("filters by providerId, serviceId, and status when provided", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getBookings({ providerId: "019f4e4e-8116-7052-b15e-b79b5ccb1af9", serviceId: "019f4e4e-8116-7052-b15e-b79b5ccb1af0", status: "CANCELLED" });

    expect(countMock).toHaveBeenCalledWith({
      where: {
        providerId: "019f4e4e-8116-7052-b15e-b79b5ccb1af9",
        serviceId: "019f4e4e-8116-7052-b15e-b79b5ccb1af0",
        status: "CANCELLED",
      },
    });
  });

  it("short-circuits to an empty result for a malformed providerId, never calling Prisma", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");

    const result = await getBookings({ providerId: "not-a-uuid" });

    expect(result).toEqual({ items: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 1 });
    expect(countMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  // Admin Operations Platform additions — both additive, backward
  // compatible (the test above already confirms a single BookingStatus
  // value still filters exactly as before).
  it("accepts a BookingStatus[] and translates it to an `in` filter (used by the Recently Cancelled queue)", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    await getBookings({ status: ["CANCELLED", "REJECTED"] });

    expect(countMock).toHaveBeenCalledWith({ where: { status: { in: ["CANCELLED", "REJECTED"] } } });
  });

  it("filters by updatedAfter as a plain lower-bound on updatedAt", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(0);
    findManyMock.mockResolvedValue([]);

    const since = new Date("2026-06-01T00:00:00Z");
    await getBookings({ updatedAfter: since });

    expect(countMock).toHaveBeenCalledWith({ where: { updatedAt: { gte: since } } });
  });

  // BOOKING TOTAL PRESENTATION (§30) — admin surfaces the effective TOTAL while keeping the unit
  // price as a distinct operational fact.
  it("carries a booking-total view distinct from the unit price snapshot", async () => {
    requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
    getLocaleMock.mockResolvedValue("en");
    countMock.mockResolvedValue(1);
    findManyMock.mockResolvedValue([
      {
        id: "booking-1", customerId: "c1", serviceId: "s1", providerId: "p1", status: "COMPLETED", seats: 5,
        priceSnapshotAmount: "10.00", priceSnapshotCurrency: "OMR",
        pricingUnitSnapshot: "PER_PERSON", billableQuantitySnapshot: 5, bookingTotalSnapshot: "50.00",
        createdAt: new Date(), service: { name: { en: "Tour" } }, provider: { businessName: { en: "Co" } },
        availability: null,
      },
    ]);

    const item = (await getBookings()).items[0]!;
    expect(item.priceSnapshot).toBe("10.00 OMR"); // unit, operationally useful
    expect(item.bookingMoney).toMatchObject({ available: true, moneyMode: "TOTALIZED", total: "50.00", unitAmount: "10.00", billableQuantity: 5 });
  });
});
