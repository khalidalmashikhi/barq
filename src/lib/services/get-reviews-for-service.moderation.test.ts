import { describe, it, expect, vi, afterEach } from "vitest";

// REVIEW TRUST & SAFETY — proves the public service-detail reviews LIST hides non-PUBLISHED reviews.
// The rating aggregate (get-service-rating-aggregate.test) and provider-profile aggregate
// (get-provider-profile.test) already assert the same PUBLISHED filter; this closes the last public
// display surface. Because the query filters moderationState:"PUBLISHED", a FLAGGED or REMOVED
// review is provably excluded, and a restored (→PUBLISHED) one is included again — with no change to
// this query when moderation happens.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/i18n/get-server-translator", () => ({
  getServerTranslator: async () => (key: string) => key,
}));

const reviewFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: { review: { findMany: (...a: unknown[]) => reviewFindManyMock(...a) } },
}));

const { getReviewsForService } = await import("./get-service-detail");

const SERVICE_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";

afterEach(() => reviewFindManyMock.mockReset());

describe("getReviewsForService — only PUBLISHED reviews reach the public service detail", () => {
  it("filters moderationState:'PUBLISHED' (FLAGGED/REMOVED are excluded)", async () => {
    reviewFindManyMock.mockResolvedValue([]);
    await getReviewsForService(SERVICE_ID);
    expect(reviewFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { moderationState: "PUBLISHED", booking: { serviceId: SERVICE_ID } },
      }),
    );
  });

  it("returns [] for a malformed serviceId without querying", async () => {
    expect(await getReviewsForService("not-a-uuid")).toEqual([]);
    expect(reviewFindManyMock).not.toHaveBeenCalled();
  });
});
