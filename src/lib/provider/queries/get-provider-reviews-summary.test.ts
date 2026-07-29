import { describe, it, expect, vi, afterEach } from "vitest";

// Provider Analytics & Business Insights — regression tests for the
// first provider-facing review/rating query. Confirms averageRating
// is null (never 0) for a provider with zero reviews, mirroring
// get-provider-metrics.ts's own completion/cancellation rate
// convention, and that recentReviews carries the reviewed service's
// name (no customer identity is ever exposed).

vi.mock("server-only", () => ({}));

const requireProviderMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireProvider: (...args: unknown[]) => requireProviderMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
}));

const aggregateMock = vi.fn();
const findManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    rating: {
      aggregate: (...args: unknown[]) => aggregateMock(...args),
    },
    review: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

const { getProviderReviewsSummary, isHighRatedMilestone } = await import("./get-provider-reviews-summary");

afterEach(() => {
  requireProviderMock.mockReset();
  aggregateMock.mockReset();
  findManyMock.mockReset();
});

describe("getProviderReviewsSummary", () => {
  it("returns null average rating (not 0) and an empty list for a provider with zero reviews", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    aggregateMock.mockResolvedValue({ _avg: { value: null }, _count: { value: 0 } });
    findManyMock.mockResolvedValue([]);

    const summary = await getProviderReviewsSummary();

    expect(summary).toEqual({ averageRating: null, reviewCount: 0, recentReviews: [] });
  });

  it("returns the real average/count and maps recent reviews to their service name, never a customer identity", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "provider-1" } });
    aggregateMock.mockResolvedValue({ _avg: { value: 4.5 }, _count: { value: 12 } });
    findManyMock.mockResolvedValue([
      {
        id: "review-1",
        content: "Loved it!",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        rating: { value: 5 },
        booking: { service: { name: { en: "Desert Safari", ar: "سفاري" } } },
      },
    ]);

    const summary = await getProviderReviewsSummary();

    expect(summary.averageRating).toBe(4.5);
    expect(summary.reviewCount).toBe(12);
    expect(summary.recentReviews).toEqual([
      {
        id: "review-1",
        serviceName: "Desert Safari",
        rating: 5,
        content: "Loved it!",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
  });
});

describe("isHighRatedMilestone — Provider Notifications & Operational Alerts phase", () => {
  // Approved product rule (BOTH conditions required): average rating
  // >= HIGH_RATED_MILESTONE_MIN_RATING (4.5) AND review count >=
  // HIGH_RATED_MILESTONE_MIN_REVIEWS (10) — see this function's own
  // comment in get-provider-reviews-summary.ts for the approval trail.
  it("does not trigger at 4.49 average / 10 reviews — just below the rating threshold", () => {
    expect(isHighRatedMilestone({ averageRating: 4.49, reviewCount: 10 })).toBe(false);
  });

  it("does not trigger at 4.50 average / 9 reviews — just below the review-count threshold", () => {
    expect(isHighRatedMilestone({ averageRating: 4.5, reviewCount: 9 })).toBe(false);
  });

  it("triggers at exactly 4.50 average / 10 reviews — both thresholds met at their boundary", () => {
    expect(isHighRatedMilestone({ averageRating: 4.5, reviewCount: 10 })).toBe(true);
  });

  it("does not trigger at 5.00 average / 1 review — high rating alone is not enough", () => {
    expect(isHighRatedMilestone({ averageRating: 5.0, reviewCount: 1 })).toBe(false);
  });

  it("does not trigger when there is no rating data at all (null average)", () => {
    expect(isHighRatedMilestone({ averageRating: null, reviewCount: 0 })).toBe(false);
  });
});
