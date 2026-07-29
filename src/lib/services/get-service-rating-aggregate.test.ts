import { describe, it, expect, vi, afterEach } from "vitest";

// Growth Foundations phase — regression tests for
// getServiceRatingAggregate(), used only by the new Product JSON-LD on
// the Service Detail page. Mirrors get-provider-profile.test.ts's own
// Rating-aggregate mocking shape.

vi.mock("server-only", () => ({}));

const ratingAggregateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    rating: {
      aggregate: (...args: unknown[]) => ratingAggregateMock(...args),
    },
  },
}));

const { getServiceRatingAggregate } = await import("./get-service-detail");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => {
  ratingAggregateMock.mockReset();
});

describe("getServiceRatingAggregate", () => {
  it("returns null/0 for a malformed serviceId without querying Prisma", async () => {
    const result = await getServiceRatingAggregate("not-a-uuid");

    expect(result).toEqual({ averageRating: null, reviewCount: 0 });
    expect(ratingAggregateMock).not.toHaveBeenCalled();
  });

  it("scopes the aggregate to PUBLISHED reviews for this service's bookings only", async () => {
    ratingAggregateMock.mockResolvedValue({ _avg: { value: null }, _count: { value: 0 } });

    await getServiceRatingAggregate(SERVICE_ID);

    expect(ratingAggregateMock).toHaveBeenCalledWith({
      where: { review: { moderationState: "PUBLISHED", booking: { serviceId: SERVICE_ID } } },
      _avg: { value: true },
      _count: { value: true },
    });
  });

  it("returns an honest null average and 0 count when no reviews exist yet", async () => {
    ratingAggregateMock.mockResolvedValue({ _avg: { value: null }, _count: { value: 0 } });

    const result = await getServiceRatingAggregate(SERVICE_ID);

    expect(result).toEqual({ averageRating: null, reviewCount: 0 });
  });

  it("returns the real average and count when reviews exist", async () => {
    ratingAggregateMock.mockResolvedValue({ _avg: { value: 4.5 }, _count: { value: 8 } });

    const result = await getServiceRatingAggregate(SERVICE_ID);

    expect(result).toEqual({ averageRating: 4.5, reviewCount: 8 });
  });
});
