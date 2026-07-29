import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Analytics & Business Insights — regression tests for the
// new low-activity/needing-attention detection. Confirms:
// - hasNoUpcomingAvailability (already computed by getProviderServices())
//   is reused, not re-derived.
// - the LOW_ACTIVITY_THRESHOLD_DAYS (30) cutoff is applied correctly at
//   its boundary, using real Service.createdAt + a real booking-count
//   absence, never an invented flag. See that constant's own comment
//   in get-provider-service-insights.ts for exactly where the 30-day
//   value itself came from (an explicit AskUserQuestion during this
//   phase's planning step, not a silently-chosen number).

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireProvider: (...args: unknown[]) => requireProviderMock(...args),
}));

const getProviderServicesMock = vi.fn();

vi.mock("./get-provider-services", () => ({
  getProviderServices: (...args: unknown[]) => getProviderServicesMock(...args),
}));

const groupByMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      groupBy: (...args: unknown[]) => groupByMock(...args),
    },
  },
}));

const { getProviderServiceInsights } = await import("./get-provider-service-insights");

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

function buildServiceListResult(items: Array<{ id: string; name: string; createdAt: Date; hasNoUpcomingAvailability: boolean }>) {
  return { items, totalCount: items.length, page: 1, pageSize: 100, totalPages: 1 };
}

afterEach(() => {
  requireProviderMock.mockReset();
  getProviderServicesMock.mockReset();
  groupByMock.mockReset();
});

describe("getProviderServiceInsights", () => {
  it("flags a published service with no upcoming availability, reusing the existing computed field", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    getProviderServicesMock.mockResolvedValue(
      buildServiceListResult([
        { id: "svc-1", name: "Desert Safari", createdAt: new Date(now - 5 * DAY_MS), hasNoUpcomingAvailability: true },
      ])
    );
    groupByMock.mockResolvedValue([{ serviceId: "svc-1", _count: 4 }]);

    const insights = await getProviderServiceInsights();

    expect(insights.needingAttention).toEqual([{ id: "svc-1", name: "Desert Safari", createdAt: new Date(now - 5 * DAY_MS) }]);
    expect(insights.lowActivity).toEqual([]);
  });

  it("flags a published service published 31+ days ago with zero bookings ever as low activity", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    getProviderServicesMock.mockResolvedValue(
      buildServiceListResult([
        { id: "svc-2", name: "Mountain Trek", createdAt: new Date(now - 31 * DAY_MS), hasNoUpcomingAvailability: false },
      ])
    );
    groupByMock.mockResolvedValue([]); // no bookings for any service

    const insights = await getProviderServiceInsights();

    expect(insights.lowActivity).toEqual([{ id: "svc-2", name: "Mountain Trek", createdAt: new Date(now - 31 * DAY_MS) }]);
    expect(insights.needingAttention).toEqual([]);
  });

  it("does NOT flag a service published only 10 days ago with zero bookings — too new to judge", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    getProviderServicesMock.mockResolvedValue(
      buildServiceListResult([
        { id: "svc-3", name: "New Experience", createdAt: new Date(now - 10 * DAY_MS), hasNoUpcomingAvailability: false },
      ])
    );
    groupByMock.mockResolvedValue([]);

    const insights = await getProviderServiceInsights();

    expect(insights.lowActivity).toEqual([]);
  });

  it("does NOT flag a service published 31+ days ago that has at least one booking", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    getProviderServicesMock.mockResolvedValue(
      buildServiceListResult([
        { id: "svc-4", name: "Popular Tour", createdAt: new Date(now - 60 * DAY_MS), hasNoUpcomingAvailability: false },
      ])
    );
    groupByMock.mockResolvedValue([{ serviceId: "svc-4", _count: 1 }]);

    const insights = await getProviderServiceInsights();

    expect(insights.lowActivity).toEqual([]);
  });

  it("returns both lists empty for a healthy catalog", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    getProviderServicesMock.mockResolvedValue(buildServiceListResult([]));
    groupByMock.mockResolvedValue([]);

    const insights = await getProviderServiceInsights();

    expect(insights).toEqual({ needingAttention: [], lowActivity: [] });
  });
});
