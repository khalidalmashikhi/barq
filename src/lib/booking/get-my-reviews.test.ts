import { describe, it, expect, vi, afterEach } from "vitest";

// Customer Experience Platform — regression tests for getMyReviewsPageData().
// Confirms: customer isolation (scoped by customerId derived from the
// authenticated user, never trusting client input), awaiting-review
// eligibility (COMPLETED + no Review only), a reviewed booking is
// excluded from Awaiting Review, a non-completed booking never appears
// there, Reviews Given pagination math, and honest empty states for a
// user with no Customer profile.

vi.mock("server-only", () => ({}));

const requireAuthMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuth: (...args: unknown[]) => requireAuthMock(...args),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
}));

const customerFindUniqueMock = vi.fn();
const bookingFindManyMock = vi.fn();
const reviewCountMock = vi.fn();
const reviewFindManyMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: {
      findUnique: (...args: unknown[]) => customerFindUniqueMock(...args),
    },
    booking: {
      findMany: (...args: unknown[]) => bookingFindManyMock(...args),
    },
    review: {
      count: (...args: unknown[]) => reviewCountMock(...args),
      findMany: (...args: unknown[]) => reviewFindManyMock(...args),
    },
  },
}));

const { getMyReviewsPageData } = await import("./get-my-reviews");

afterEach(() => {
  requireAuthMock.mockReset();
  customerFindUniqueMock.mockReset();
  bookingFindManyMock.mockReset();
  reviewCountMock.mockReset();
  reviewFindManyMock.mockReset();
});

describe("getMyReviewsPageData — customer isolation and empty states", () => {
  it("returns an honest empty page for a user with no Customer profile, without querying bookings/reviews", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    customerFindUniqueMock.mockResolvedValue(null);

    const result = await getMyReviewsPageData();

    expect(result).toEqual({ awaitingReview: [], reviewsGiven: [], reviewsGivenTotalCount: 0, page: 1, pageSize: 10, totalPages: 1 });
    expect(bookingFindManyMock).not.toHaveBeenCalled();
    expect(reviewFindManyMock).not.toHaveBeenCalled();
  });

  it("scopes both queries by the resolved customer's own id, derived from the authenticated user", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    customerFindUniqueMock.mockResolvedValue({ id: "customer-1" });
    bookingFindManyMock.mockResolvedValue([]);
    reviewCountMock.mockResolvedValue(0);
    reviewFindManyMock.mockResolvedValue([]);

    await getMyReviewsPageData();

    expect(bookingFindManyMock.mock.calls[0]![0].where).toMatchObject({ customerId: "customer-1", status: "COMPLETED", review: null });
    expect(reviewFindManyMock.mock.calls[0]![0].where).toEqual({ customerId: "customer-1" });
    expect(reviewCountMock).toHaveBeenCalledWith({ where: { customerId: "customer-1" } });
  });
});

describe("getMyReviewsPageData — Awaiting Review eligibility", () => {
  it("includes a COMPLETED booking with no review", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    customerFindUniqueMock.mockResolvedValue({ id: "customer-1" });
    bookingFindManyMock.mockResolvedValue([{ id: "booking-1", service: { name: { en: "Desert Safari" } } }]);
    reviewCountMock.mockResolvedValue(0);
    reviewFindManyMock.mockResolvedValue([]);

    const result = await getMyReviewsPageData();

    expect(result.awaitingReview).toEqual([{ id: "booking-1", serviceName: "Desert Safari" }]);
  });

  it("the underlying query filters to status COMPLETED and review: null — a reviewed or non-completed booking is excluded at the query level", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    customerFindUniqueMock.mockResolvedValue({ id: "customer-1" });
    bookingFindManyMock.mockResolvedValue([]);
    reviewCountMock.mockResolvedValue(0);
    reviewFindManyMock.mockResolvedValue([]);

    await getMyReviewsPageData();

    const call = bookingFindManyMock.mock.calls[0]![0];
    expect(call.where.status).toBe("COMPLETED");
    expect(call.where.review).toBeNull();
  });
});

describe("getMyReviewsPageData — Reviews Given pagination", () => {
  it("maps review rows to the presentation shape with service/provider context, rating, and date", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    customerFindUniqueMock.mockResolvedValue({ id: "customer-1" });
    bookingFindManyMock.mockResolvedValue([]);
    reviewCountMock.mockResolvedValue(1);
    reviewFindManyMock.mockResolvedValue([
      {
        id: "review-1",
        content: "Loved it!",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        rating: { value: 5 },
        booking: {
          id: "booking-9",
          serviceId: "service-9",
          service: { name: { en: "Wadi Darbat Tour" } },
          provider: { businessName: { en: "Oman Trails" } },
        },
      },
    ]);

    const result = await getMyReviewsPageData();

    expect(result.reviewsGiven).toEqual([
      {
        id: "review-1",
        bookingId: "booking-9",
        serviceId: "service-9",
        serviceName: "Wadi Darbat Tour",
        providerName: "Oman Trails",
        rating: 5,
        content: "Loved it!",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
  });

  it("computes totalPages from the real review count, and passes through page/pageSize", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    customerFindUniqueMock.mockResolvedValue({ id: "customer-1" });
    bookingFindManyMock.mockResolvedValue([]);
    reviewCountMock.mockResolvedValue(25);
    reviewFindManyMock.mockResolvedValue([]);

    const result = await getMyReviewsPageData({ page: 2, pageSize: 10 });

    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(3);
    expect(reviewFindManyMock.mock.calls[0]![0].skip).toBe(10);
    expect(reviewFindManyMock.mock.calls[0]![0].take).toBe(10);
  });

  it("returns an empty Reviews Given list for a customer with zero reviews, never a fabricated row", async () => {
    requireAuthMock.mockResolvedValue({ barqUser: { id: "user-1" } });
    customerFindUniqueMock.mockResolvedValue({ id: "customer-1" });
    bookingFindManyMock.mockResolvedValue([]);
    reviewCountMock.mockResolvedValue(0);
    reviewFindManyMock.mockResolvedValue([]);

    const result = await getMyReviewsPageData();

    expect(result.reviewsGiven).toEqual([]);
    expect(result.reviewsGivenTotalCount).toBe(0);
    expect(result.totalPages).toBe(1);
  });
});
