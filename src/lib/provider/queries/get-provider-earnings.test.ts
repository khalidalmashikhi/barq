import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Billing & Earnings Foundation — regression tests. Confirms
// the product rules applied to this phase: currencies are never
// merged, a null commissionSnapshotAmount contributes zero commission
// (not an error, not a skip), CANCELLED+REJECTED fold into one
// Cancelled/Lost Revenue figure, PENDING_PROVIDER+CONFIRMED+
// IN_PROGRESS fold into one Pending Revenue figure, Today/This-Month
// queries are scoped by confirmedAt (never createdAt), and Revenue by
// Service is ordered revenue desc -> completed count desc ->
// alphabetical.

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireProvider: (...args: unknown[]) => requireProviderMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
}));

const queryRawMock = vi.fn();
const findManyServiceMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    // DOWNSTREAM MONEY ALIGNMENT — the 4 grouped queries are now raw $queryRaw summing the
    // effective total (COALESCE(bookingTotalSnapshot, priceSnapshotAmount)), not groupBy _sum.
    $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    service: {
      findMany: (...args: unknown[]) => findManyServiceMock(...args),
    },
  },
}));

const { getProviderEarnings } = await import("./get-provider-earnings");

afterEach(() => {
  requireProviderMock.mockReset();
  queryRawMock.mockReset();
  findManyServiceMock.mockReset();
});

// The module issues exactly 4 $queryRaw calls, in this order, inside one Promise.all:
// status+currency buckets, today revenue, this-month revenue, revenue-by-service. Tests still
// pass rows in the readable old groupBy shape; this harness maps them to the raw-row column
// names the module reads (sumtotal/sumcommission/avgtotal/count, currency), so gross reflects
// the EFFECTIVE total. `sumtotal` is fed from the test's priceSnapshotAmount for readability.
type OldRow = { status?: string; serviceId?: string; priceSnapshotCurrency: string | null; _sum: { priceSnapshotAmount: unknown; commissionSnapshotAmount?: unknown }; _avg?: { priceSnapshotAmount: unknown }; _count?: number };
const mapStatus = (r: OldRow) => ({ status: r.status, currency: r.priceSnapshotCurrency, sumtotal: r._sum.priceSnapshotAmount, sumcommission: r._sum.commissionSnapshotAmount ?? null, avgtotal: r._avg?.priceSnapshotAmount ?? null, count: r._count ?? 0 });
const mapCurrency = (r: OldRow) => ({ currency: r.priceSnapshotCurrency, sumtotal: r._sum.priceSnapshotAmount });
const mapService = (r: OldRow) => ({ serviceId: r.serviceId, currency: r.priceSnapshotCurrency, sumtotal: r._sum.priceSnapshotAmount, avgtotal: r._avg?.priceSnapshotAmount ?? null, count: r._count ?? 0 });

function mockGroupByCalls(
  statusCurrencyRows: OldRow[],
  todayRows: OldRow[] = [],
  monthRows: OldRow[] = [],
  serviceRows: OldRow[] = []
) {
  queryRawMock
    .mockResolvedValueOnce(statusCurrencyRows.map(mapStatus))
    .mockResolvedValueOnce(todayRows.map(mapCurrency))
    .mockResolvedValueOnce(monthRows.map(mapCurrency))
    .mockResolvedValueOnce(serviceRows.map(mapService));
}

describe("getProviderEarnings — multi-currency grouping", () => {
  it("never merges currencies — each currency is its own row, never summed together", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    mockGroupByCalls([
      {
        status: "COMPLETED",
        priceSnapshotCurrency: "OMR",
        _sum: { priceSnapshotAmount: 100, commissionSnapshotAmount: 10 },
        _avg: { priceSnapshotAmount: 50 },
        _count: 2,
      },
      {
        status: "COMPLETED",
        priceSnapshotCurrency: "USD",
        _sum: { priceSnapshotAmount: 200, commissionSnapshotAmount: 20 },
        _avg: { priceSnapshotAmount: 200 },
        _count: 1,
      },
    ]);
    findManyServiceMock.mockResolvedValue([]);

    const earnings = await getProviderEarnings();

    expect(earnings.grossRevenueByCurrency).toEqual([
      { amount: "100.00", currency: "OMR" },
      { amount: "200.00", currency: "USD" },
    ]);
  });
});

describe("getProviderEarnings — Estimated Net Earnings", () => {
  it("treats a null commissionSnapshotAmount as zero commission — the full price counts, never dropped or errored", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    mockGroupByCalls([
      {
        status: "COMPLETED",
        priceSnapshotCurrency: "OMR",
        _sum: { priceSnapshotAmount: 100, commissionSnapshotAmount: null },
        _avg: { priceSnapshotAmount: 100 },
        _count: 1,
      },
    ]);
    findManyServiceMock.mockResolvedValue([]);

    const earnings = await getProviderEarnings();

    expect(earnings.estimatedNetEarningsByCurrency).toEqual([{ amount: "100.00", currency: "OMR" }]);
  });

  it("computes gross minus commission when a commission snapshot is present", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    mockGroupByCalls([
      {
        status: "COMPLETED",
        priceSnapshotCurrency: "OMR",
        _sum: { priceSnapshotAmount: 100, commissionSnapshotAmount: 12 },
        _avg: { priceSnapshotAmount: 100 },
        _count: 1,
      },
    ]);
    findManyServiceMock.mockResolvedValue([]);

    const earnings = await getProviderEarnings();

    expect(earnings.estimatedNetEarningsByCurrency).toEqual([{ amount: "88.00", currency: "OMR" }]);
  });
});

describe("getProviderEarnings — cancelled/rejected and pending aggregation", () => {
  it("combines CANCELLED and REJECTED into one Cancelled/Lost Revenue figure per currency", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    mockGroupByCalls([
      {
        status: "CANCELLED",
        priceSnapshotCurrency: "OMR",
        _sum: { priceSnapshotAmount: 30, commissionSnapshotAmount: null },
        _avg: { priceSnapshotAmount: 30 },
        _count: 1,
      },
      {
        status: "REJECTED",
        priceSnapshotCurrency: "OMR",
        _sum: { priceSnapshotAmount: 20, commissionSnapshotAmount: null },
        _avg: { priceSnapshotAmount: 20 },
        _count: 1,
      },
    ]);
    findManyServiceMock.mockResolvedValue([]);

    const earnings = await getProviderEarnings();

    expect(earnings.cancelledLostRevenueByCurrency).toEqual([{ amount: "50.00", currency: "OMR" }]);
  });

  it("combines PENDING_PROVIDER, CONFIRMED, and IN_PROGRESS into one Pending Revenue figure", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    mockGroupByCalls([
      {
        status: "PENDING_PROVIDER",
        priceSnapshotCurrency: "OMR",
        _sum: { priceSnapshotAmount: 10, commissionSnapshotAmount: null },
        _avg: { priceSnapshotAmount: 10 },
        _count: 1,
      },
      {
        status: "CONFIRMED",
        priceSnapshotCurrency: "OMR",
        _sum: { priceSnapshotAmount: 15, commissionSnapshotAmount: 1.5 },
        _avg: { priceSnapshotAmount: 15 },
        _count: 1,
      },
      {
        status: "IN_PROGRESS",
        priceSnapshotCurrency: "OMR",
        _sum: { priceSnapshotAmount: 20, commissionSnapshotAmount: 2 },
        _avg: { priceSnapshotAmount: 20 },
        _count: 1,
      },
    ]);
    findManyServiceMock.mockResolvedValue([]);

    const earnings = await getProviderEarnings();

    expect(earnings.pendingRevenueByCurrency).toEqual([{ amount: "45.00", currency: "OMR" }]);
  });
});

describe("getProviderEarnings — confirmedAt date boundaries", () => {
  it("scopes Revenue Today and Revenue This Month by confirmedAt, never createdAt", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    mockGroupByCalls(
      [],
      [{ priceSnapshotCurrency: "OMR", _sum: { priceSnapshotAmount: 5 } }],
      [{ priceSnapshotCurrency: "OMR", _sum: { priceSnapshotAmount: 25 } }]
    );
    findManyServiceMock.mockResolvedValue([]);

    const earnings = await getProviderEarnings();

    expect(earnings.grossRevenueTodayByCurrency).toEqual([{ amount: "5.00", currency: "OMR" }]);
    expect(earnings.grossRevenueThisMonthByCurrency).toEqual([{ amount: "25.00", currency: "OMR" }]);

    // The today/month revenue queries scope by confirmedAt (never createdAt) and COMPLETED —
    // now asserted against the raw SQL text of the 2nd and 3rd $queryRaw calls.
    const todaySql = (queryRawMock.mock.calls[1]![0] as { sql: string }).sql;
    const monthSql = (queryRawMock.mock.calls[2]![0] as { sql: string }).sql;
    for (const sql of [todaySql, monthSql]) {
      expect(sql).toContain("confirmedAt");
      expect(sql).not.toContain("createdAt");
      expect(sql).toContain("status = 'COMPLETED'");
    }
  });
});

describe("getProviderEarnings — Revenue by Service ordering", () => {
  it("orders by revenue desc, then completed bookings desc, then alphabetically for remaining ties", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    mockGroupByCalls(
      [],
      [],
      [],
      [
        { serviceId: "svc-tie-b", priceSnapshotCurrency: "OMR", _sum: { priceSnapshotAmount: 50 }, _avg: { priceSnapshotAmount: 25 }, _count: 2 },
        { serviceId: "svc-tie-a", priceSnapshotCurrency: "OMR", _sum: { priceSnapshotAmount: 50 }, _avg: { priceSnapshotAmount: 25 }, _count: 2 },
        { serviceId: "svc-top", priceSnapshotCurrency: "OMR", _sum: { priceSnapshotAmount: 100 }, _avg: { priceSnapshotAmount: 100 }, _count: 1 },
        { serviceId: "svc-more-bookings", priceSnapshotCurrency: "OMR", _sum: { priceSnapshotAmount: 50 }, _avg: { priceSnapshotAmount: 10 }, _count: 5 },
      ]
    );
    findManyServiceMock.mockResolvedValue([
      { id: "svc-top", name: { en: "Top Service" } },
      { id: "svc-tie-a", name: { en: "Alpha Service" } },
      { id: "svc-tie-b", name: { en: "Beta Service" } },
      { id: "svc-more-bookings", name: { en: "Popular Service" } },
    ]);

    const earnings = await getProviderEarnings();

    expect(earnings.revenueByService).toHaveLength(1);
    const [omrGroup] = earnings.revenueByService;
    expect(omrGroup!.currency).toBe("OMR");
    expect(omrGroup!.services.map((s) => s.serviceId)).toEqual([
      "svc-top",
      "svc-more-bookings",
      "svc-tie-a",
      "svc-tie-b",
    ]);
  });
});

describe("getProviderEarnings — empty data", () => {
  it("returns empty arrays, never a fabricated zero row, when a provider has no bookings in a bucket", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    mockGroupByCalls([], [], [], []);
    findManyServiceMock.mockResolvedValue([]);

    const earnings = await getProviderEarnings();

    expect(earnings).toEqual({
      grossRevenueByCurrency: [],
      estimatedNetEarningsByCurrency: [],
      cancelledLostRevenueByCurrency: [],
      pendingRevenueByCurrency: [],
      averageBookingValueByCurrency: [],
      grossRevenueTodayByCurrency: [],
      grossRevenueThisMonthByCurrency: [],
      revenueByService: [],
    });
  });
});

describe("getProviderEarnings — Average Booking Value", () => {
  it("reads the average directly from the completed bucket's own Postgres-computed average", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    mockGroupByCalls([
      {
        status: "COMPLETED",
        priceSnapshotCurrency: "OMR",
        _sum: { priceSnapshotAmount: 90, commissionSnapshotAmount: 9 },
        _avg: { priceSnapshotAmount: 30 },
        _count: 3,
      },
    ]);
    findManyServiceMock.mockResolvedValue([]);

    const earnings = await getProviderEarnings();

    expect(earnings.averageBookingValueByCurrency).toEqual([{ amount: "30.00", currency: "OMR" }]);
  });
});
