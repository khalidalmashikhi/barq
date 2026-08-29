import { describe, it, expect, vi, afterEach } from "vitest";

// Admin Operations Platform — regression tests for getAdminOverview().
// Covers the metric definitions this phase explicitly requires to be
// documented and correct: reused booking-status folding (including the
// CANCELLED+REJECTED rule and missing-status zero handling), a
// PUBLISHED-only average rating kept separate from the total review
// count, and multi-currency gross revenue that is never merged or
// converted into a single total.

vi.mock("server-only", () => ({}));

const requireAdminMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}));

const getLocaleMock = vi.fn();
vi.mock("next-intl/server", () => ({
  getLocale: () => getLocaleMock(),
}));

const checkDatabaseHealthMock = vi.fn();
vi.mock("@/lib/observability/check-database-health", () => ({
  checkDatabaseHealth: (...args: unknown[]) => checkDatabaseHealthMock(...args),
}));

const getPendingProvidersMock = vi.fn();
vi.mock("@/lib/admin/get-pending-providers", () => ({
  getPendingProviders: (...args: unknown[]) => getPendingProvidersMock(...args),
}));

const getBookingsMock = vi.fn();
vi.mock("@/lib/admin/get-bookings", () => ({
  getBookings: (...args: unknown[]) => getBookingsMock(...args),
}));

const customerCountMock = vi.fn();
const providerCountMock = vi.fn();
const serviceCountMock = vi.fn();
const bookingGroupByMock = vi.fn();
const bookingCountMock = vi.fn();
const reviewCountMock = vi.fn();
const ratingAggregateMock = vi.fn();
const customerFindManyMock = vi.fn();
const providerFindManyMock = vi.fn();
const reviewFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: { count: (...a: unknown[]) => customerCountMock(...a), findMany: (...a: unknown[]) => customerFindManyMock(...a) },
    provider: { count: (...a: unknown[]) => providerCountMock(...a), findMany: (...a: unknown[]) => providerFindManyMock(...a) },
    service: { count: (...a: unknown[]) => serviceCountMock(...a) },
    booking: { groupBy: (...a: unknown[]) => bookingGroupByMock(...a), count: (...a: unknown[]) => bookingCountMock(...a) },
    review: { count: (...a: unknown[]) => reviewCountMock(...a), findMany: (...a: unknown[]) => reviewFindManyMock(...a) },
    rating: { aggregate: (...a: unknown[]) => ratingAggregateMock(...a) },
    // DOWNSTREAM MONEY ALIGNMENT — GMV now sums the effective total via $queryRaw.
    $queryRaw: (...a: unknown[]) => queryRawMock(...a),
  },
}));

const queryRawMock = vi.fn();

const { getAdminOverview } = await import("./get-admin-overview");

function emptyBookingsResult() {
  return { items: [], totalCount: 0, page: 1, pageSize: 5, totalPages: 1 };
}

function setDefaults() {
  requireAdminMock.mockResolvedValue({ admin: { id: "admin-1" } });
  getLocaleMock.mockResolvedValue("en");
  checkDatabaseHealthMock.mockResolvedValue("ok");
  getPendingProvidersMock.mockResolvedValue([]);
  getBookingsMock.mockResolvedValue(emptyBookingsResult());
  customerCountMock.mockResolvedValue(0);
  providerCountMock.mockResolvedValue(0);
  serviceCountMock.mockResolvedValue(0);
  bookingGroupByMock.mockResolvedValue([]);
  queryRawMock.mockResolvedValue([]);
  bookingCountMock.mockResolvedValue(0);
  reviewCountMock.mockResolvedValue(0);
  ratingAggregateMock.mockResolvedValue({ _avg: { value: null } });
  customerFindManyMock.mockResolvedValue([]);
  providerFindManyMock.mockResolvedValue([]);
  reviewFindManyMock.mockResolvedValue([]);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("getAdminOverview", () => {
  it("requires an Admin", async () => {
    setDefaults();
    await getAdminOverview();
    expect(requireAdminMock).toHaveBeenCalled();
  });

  it("folds booking status counts using the shared helper — CONFIRMED+IN_PROGRESS active, COMPLETED completed, CANCELLED+REJECTED cancelled, missing statuses zero", async () => {
    setDefaults();
    bookingGroupByMock.mockResolvedValue([
      { status: "CONFIRMED", _count: 2 },
      { status: "IN_PROGRESS", _count: 1 },
      { status: "COMPLETED", _count: 5 },
      { status: "CANCELLED", _count: 3 },
      { status: "REJECTED", _count: 1 },
    ]);

    const result = await getAdminOverview();

    expect(result.bookingStatusCounts).toEqual({ total: 12, active: 3, completed: 5, cancelled: 4 });
  });

  it("counts total reviews and PUBLISHED-only reviews separately, never mixed", async () => {
    setDefaults();
    reviewCountMock.mockImplementation((args?: { where?: { moderationState?: string } }) => {
      if (args?.where?.moderationState === "PUBLISHED") return Promise.resolve(4);
      return Promise.resolve(6);
    });
    ratingAggregateMock.mockResolvedValue({ _avg: { value: 4.5 } });

    const result = await getAdminOverview();

    expect(result.totalReviewCount).toBe(6);
    expect(result.publishedReviewCount).toBe(4);
    expect(result.averageRating).toBe(4.5);
    expect(ratingAggregateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { review: { moderationState: "PUBLISHED" } } })
    );
  });

  it("returns null (never 0) for average rating when there are zero PUBLISHED reviews", async () => {
    setDefaults();
    ratingAggregateMock.mockResolvedValue({ _avg: { value: null } });

    const result = await getAdminOverview();

    expect(result.averageRating).toBeNull();
  });

  it("keeps completed gross revenue separate per currency — never a merged/converted total", async () => {
    setDefaults();
    // Effective-total GMV via $queryRaw (COALESCE(total, unit)) — separate per currency.
    queryRawMock.mockResolvedValue([
      { currency: "OMR", sum: "120.00", avg: "60.00", count: 2n },
      { currency: "USD", sum: "50.00", avg: "50.00", count: 1n },
    ]);

    const result = await getAdminOverview();

    expect(result.completedGrossRevenueByCurrency).toEqual([
      { amount: "120.00", currency: "OMR" },
      { amount: "50.00", currency: "USD" },
    ]);
    // No single combined-total field exists anywhere on the result.
    expect(result).not.toHaveProperty("completedGrossRevenueTotal");
  });

  it("delegates database connectivity to the shared checkDatabaseHealth() helper", async () => {
    setDefaults();
    checkDatabaseHealthMock.mockResolvedValue("error");

    const result = await getAdminOverview();

    expect(result.databaseStatus).toBe("error");
  });

  it("reuses getPendingProviders()/getBookings() for queue counts rather than re-deriving them", async () => {
    setDefaults();
    getPendingProvidersMock.mockResolvedValue([
      { id: "p1", businessName: "A", status: "APPLIED", createdAt: new Date() },
      { id: "p2", businessName: "B", status: "UNDER_REVIEW", createdAt: new Date() },
    ]);
    getBookingsMock.mockResolvedValue({ items: [], totalCount: 7, page: 1, pageSize: 5, totalPages: 2 });

    const result = await getAdminOverview();

    expect(result.pendingProviderApprovals.count).toBe(2);
    expect(result.bookingsAwaitingProvider.count).toBe(7);
    expect(getBookingsMock).toHaveBeenCalledWith(expect.objectContaining({ status: "PENDING_PROVIDER" }));
    expect(getBookingsMock).toHaveBeenCalledWith(expect.objectContaining({ status: "IN_PROGRESS" }));
    expect(getBookingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: ["CANCELLED", "REJECTED"], updatedAfter: expect.any(Date) })
    );
  });
});
