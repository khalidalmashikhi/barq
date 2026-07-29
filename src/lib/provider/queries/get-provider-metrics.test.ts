import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Analytics & Business Insights — regression test for the new
// bookingsByStatus breakdown. This is NOT a new aggregation: the same
// groupBy(by: ["status"]) this module already ran to compute
// completedBookingsCount/cancelledBookingsCount is now also returned in
// full, instead of discarding the other 7 BookingStatus values.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireProvider: (...args: unknown[]) => requireProviderMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
}));

const groupByMock = vi.fn();
const findManyServiceMock = vi.fn();
const findManyAvailabilityMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      groupBy: (...args: unknown[]) => groupByMock(...args),
    },
    availability: {
      findMany: (...args: unknown[]) => findManyAvailabilityMock(...args),
    },
    service: {
      findMany: (...args: unknown[]) => findManyServiceMock(...args),
    },
  },
}));

const { getProviderMetrics } = await import("./get-provider-metrics");

afterEach(() => {
  requireProviderMock.mockReset();
  groupByMock.mockReset();
  findManyServiceMock.mockReset();
  findManyAvailabilityMock.mockReset();
});

describe("getProviderMetrics — bookingsByStatus", () => {
  it("returns every real status present in the groupBy result, not just COMPLETED/CANCELLED", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    // Two separate groupBy calls happen in this module (status counts,
    // then top-5 services by serviceId) — both resolve through the
    // same mocked function; distinguish by call order.
    groupByMock
      .mockResolvedValueOnce([
        { status: "PENDING_PROVIDER", _count: 3 },
        { status: "COMPLETED", _count: 10 },
        { status: "CANCELLED", _count: 2 },
        { status: "REJECTED", _count: 1 },
      ])
      .mockResolvedValueOnce([]) // priceSnapshotCurrency revenue groupBy
      .mockResolvedValueOnce([]); // top services groupBy
    findManyAvailabilityMock.mockResolvedValue([]);
    findManyServiceMock.mockResolvedValue([]);

    const metrics = await getProviderMetrics();

    expect(metrics.bookingsByStatus).toEqual([
      { status: "PENDING_PROVIDER", count: 3 },
      { status: "COMPLETED", count: 10 },
      { status: "CANCELLED", count: 2 },
      { status: "REJECTED", count: 1 },
    ]);
    expect(metrics.completedBookingsCount).toBe(10);
    expect(metrics.cancelledBookingsCount).toBe(2);
    expect(metrics.totalBookingsCount).toBe(16);
  });

  it("returns an empty breakdown for a provider with zero bookings, never a padded zero-count list", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    groupByMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    findManyAvailabilityMock.mockResolvedValue([]);
    findManyServiceMock.mockResolvedValue([]);

    const metrics = await getProviderMetrics();

    expect(metrics.bookingsByStatus).toEqual([]);
    expect(metrics.completionRate).toBeNull();
    expect(metrics.cancellationRate).toBeNull();
  });
});
