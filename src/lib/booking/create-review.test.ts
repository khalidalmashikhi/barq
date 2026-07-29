import { describe, it, expect, vi, afterEach } from "vitest";

// Marketplace Completion (Review Creation Flow) — regression tests for
// createReview(). Mirrors accept-booking.test.ts's mocking shape.

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

const requireCustomerMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireCustomer: (...args: unknown[]) => requireCustomerMock(...args),
  UnauthenticatedError: class UnauthenticatedError extends Error {},
  ForbiddenError: class ForbiddenError extends Error {},
}));

const canReviewBookingMock = vi.fn();

vi.mock("@/lib/booking/cancellation-policy", () => ({
  canReviewBooking: (...args: unknown[]) => canReviewBookingMock(...args),
}));

const bookingFindFirstMock = vi.fn();
const reviewCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    booking: {
      findFirst: (...args: unknown[]) => bookingFindFirstMock(...args),
    },
    review: {
      create: (...args: unknown[]) => reviewCreateMock(...args),
    },
  },
}));

// Provider Notifications & Operational Alerts phase: createReview() now
// notifies the provider after a successful review, reusing
// notify.ts's own writer — mocked here (same shape as hooks.test.ts's
// own mock of this module) so these tests stay focused on review
// creation, not notification content.
const notifyBookingEventMock = vi.fn().mockResolvedValue(undefined);
const resolveBookingPartiesMock = vi.fn().mockResolvedValue({
  customerUserId: "user-customer-1",
  providerUserId: "user-provider-1",
});

vi.mock("@/lib/booking/lifecycle/notify", () => ({
  notifyBookingEvent: (...args: unknown[]) => notifyBookingEventMock(...args),
  resolveBookingParties: (...args: unknown[]) => resolveBookingPartiesMock(...args),
}));

const { createReview } = await import("./create-review");
const { Prisma } = await import("@prisma/client");
const { _resetRateLimitStoreForTests } = await import("@/lib/rate-limit/rate-limiter");

const BOOKING_ID = "019f4e4e-8116-7052-b15e-b79b5ccb1af9";
const CUSTOMER_ID = "019f4e4e-80b8-7cf2-b043-916c71648fcb";
const PROVIDER_ID = "019f4e4e-80dd-7760-9398-7bbb2cd8f5ea";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

afterEach(() => {
  requireCustomerMock.mockReset();
  canReviewBookingMock.mockReset();
  bookingFindFirstMock.mockReset();
  reviewCreateMock.mockReset();
  notifyBookingEventMock.mockReset();
  notifyBookingEventMock.mockResolvedValue(undefined);
  resolveBookingPartiesMock.mockReset();
  resolveBookingPartiesMock.mockResolvedValue({ customerUserId: "user-customer-1", providerUserId: "user-provider-1" });
  _resetRateLimitStoreForTests();
  vi.unstubAllEnvs();
});

describe("createReview", () => {
  it("returns INVALID_INPUT for a malformed bookingId without checking auth", async () => {
    const result = await createReview("not-a-uuid", formData({ rating: "5", content: "Great!" }));

    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(requireCustomerMock).not.toHaveBeenCalled();
  });

  it.each(["0", "6", "abc", "3.5"])("returns INVALID_RATING for an out-of-range or non-integer rating (%s)", async (rating) => {
    const result = await createReview(BOOKING_ID, formData({ rating, content: "Great experience!" }));

    expect(result).toEqual({ ok: false, error: "INVALID_RATING" });
    expect(requireCustomerMock).not.toHaveBeenCalled();
  });

  it("returns INVALID_CONTENT for empty/whitespace-only content", async () => {
    const result = await createReview(BOOKING_ID, formData({ rating: "5", content: "   " }));

    expect(result).toEqual({ ok: false, error: "INVALID_CONTENT" });
  });

  it("returns INVALID_CONTENT for content exceeding the length limit", async () => {
    const result = await createReview(BOOKING_ID, formData({ rating: "5", content: "a".repeat(2001) }));

    expect(result).toEqual({ ok: false, error: "INVALID_CONTENT" });
  });

  it("returns BOOKING_NOT_FOUND when the booking doesn't belong to the authenticated customer (or doesn't exist)", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    bookingFindFirstMock.mockResolvedValue(null);

    const result = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_FOUND" });
    expect(bookingFindFirstMock).toHaveBeenCalledWith({
      where: { id: BOOKING_ID, customerId: CUSTOMER_ID },
      include: { review: true },
    });
  });

  it("returns BOOKING_NOT_REVIEWABLE when the booking's status isn't eligible", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    bookingFindFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: PROVIDER_ID,
      status: "CONFIRMED",
      review: null,
    });
    canReviewBookingMock.mockReturnValue(false);

    const result = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

    expect(result).toEqual({ ok: false, error: "BOOKING_NOT_REVIEWABLE" });
    expect(reviewCreateMock).not.toHaveBeenCalled();
  });

  it("returns ALREADY_REVIEWED when the booking already has a Review (pre-check)", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    bookingFindFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: PROVIDER_ID,
      status: "COMPLETED",
      review: { id: "existing-review" },
    });
    canReviewBookingMock.mockReturnValue(true);

    const result = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

    expect(result).toEqual({ ok: false, error: "ALREADY_REVIEWED" });
    expect(reviewCreateMock).not.toHaveBeenCalled();
  });

  it("returns ALREADY_REVIEWED when a concurrent request wins the race (P2002 unique constraint on bookingId)", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    bookingFindFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: PROVIDER_ID,
      status: "COMPLETED",
      review: null,
    });
    canReviewBookingMock.mockReturnValue(true);
    reviewCreateMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" })
    );

    const result = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

    expect(result).toEqual({ ok: false, error: "ALREADY_REVIEWED" });
  });

  it("creates a Review+Rating using only the booking's own providerId/customerId — never trusting client-submitted linkage", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    bookingFindFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: PROVIDER_ID,
      status: "COMPLETED",
      review: null,
    });
    canReviewBookingMock.mockReturnValue(true);
    reviewCreateMock.mockResolvedValue({ id: "new-review" });

    // A malicious client submitting extra serviceId/providerId/customerId
    // fields must have zero effect — this action's FormData contract
    // doesn't even read them.
    const result = await createReview(
      BOOKING_ID,
      formData({
        rating: "4",
        content: "  Wonderful tour, highly recommend!  ",
        providerId: "attacker-provider-id",
        customerId: "attacker-customer-id",
      })
    );

    expect(result).toEqual({ ok: true });
    expect(reviewCreateMock).toHaveBeenCalledWith({
      data: {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        providerId: PROVIDER_ID,
        content: "Wonderful tour, highly recommend!",
        rating: { create: { value: 4 } },
      },
    });
  });

  it("returns UNKNOWN_ERROR and logs, without exposing internal details, on an unexpected failure", async () => {
    requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
    bookingFindFirstMock.mockResolvedValue({
      id: BOOKING_ID,
      providerId: PROVIDER_ID,
      status: "COMPLETED",
      review: null,
    });
    canReviewBookingMock.mockReturnValue(true);
    reviewCreateMock.mockRejectedValue(new Error("connection reset"));

    const result = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

    expect(result).toEqual({ ok: false, error: "UNKNOWN_ERROR" });
  });

  describe("provider notification (Provider Notifications & Operational Alerts phase)", () => {
    it("notifies the provider only after the review is actually created", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      bookingFindFirstMock.mockResolvedValue({ id: BOOKING_ID, providerId: PROVIDER_ID, status: "COMPLETED", review: null });
      canReviewBookingMock.mockReturnValue(true);
      reviewCreateMock.mockResolvedValue({ id: "new-review" });

      const result = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

      expect(result).toEqual({ ok: true });
      expect(resolveBookingPartiesMock).toHaveBeenCalledWith(BOOKING_ID);
      expect(notifyBookingEventMock).toHaveBeenCalledWith({
        userId: "user-provider-1",
        bookingId: BOOKING_ID,
        kind: "NEW_REVIEW_RECEIVED",
      });
    });

    it("does not notify when the booking isn't found", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      bookingFindFirstMock.mockResolvedValue(null);

      await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

      expect(notifyBookingEventMock).not.toHaveBeenCalled();
    });

    it("does not notify when the booking isn't reviewable", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      bookingFindFirstMock.mockResolvedValue({ id: BOOKING_ID, providerId: PROVIDER_ID, status: "CONFIRMED", review: null });
      canReviewBookingMock.mockReturnValue(false);

      await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

      expect(notifyBookingEventMock).not.toHaveBeenCalled();
    });

    it("does not notify on a duplicate review (pre-check or race)", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      bookingFindFirstMock.mockResolvedValue({
        id: BOOKING_ID,
        providerId: PROVIDER_ID,
        status: "COMPLETED",
        review: { id: "existing-review" },
      });
      canReviewBookingMock.mockReturnValue(true);

      await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

      expect(notifyBookingEventMock).not.toHaveBeenCalled();
    });

    it("does not notify on invalid input", async () => {
      await createReview(BOOKING_ID, formData({ rating: "0", content: "Great experience!" }));

      expect(notifyBookingEventMock).not.toHaveBeenCalled();
    });

    it("does not notify when review creation itself fails unexpectedly", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      bookingFindFirstMock.mockResolvedValue({ id: BOOKING_ID, providerId: PROVIDER_ID, status: "COMPLETED", review: null });
      canReviewBookingMock.mockReturnValue(true);
      reviewCreateMock.mockRejectedValue(new Error("connection reset"));

      await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

      expect(notifyBookingEventMock).not.toHaveBeenCalled();
    });

    it("still returns ok:true when the notification itself fails — a notification failure never undoes an already-successful review", async () => {
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      bookingFindFirstMock.mockResolvedValue({ id: BOOKING_ID, providerId: PROVIDER_ID, status: "COMPLETED", review: null });
      canReviewBookingMock.mockReturnValue(true);
      reviewCreateMock.mockResolvedValue({ id: "new-review" });
      notifyBookingEventMock.mockRejectedValue(new Error("notification service unavailable"));

      const result = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));

      expect(result).toEqual({ ok: true });
    });
  });

  describe("rate limiting (Production Hardening)", () => {
    it("returns RATE_LIMITED once the per-customer review-creation limit is exceeded, without touching the database", async () => {
      vi.stubEnv("RATE_LIMIT_REVIEW_CREATE_MAX", "1");
      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      bookingFindFirstMock.mockResolvedValue({ id: BOOKING_ID, providerId: PROVIDER_ID, status: "COMPLETED", review: null });
      canReviewBookingMock.mockReturnValue(true);
      reviewCreateMock.mockResolvedValue({ id: "new-review" });

      const first = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));
      expect(first).toEqual({ ok: true });

      const second = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));
      expect(second).toEqual({ ok: false, error: "RATE_LIMITED" });
      // The second, rejected attempt must never reach the database.
      expect(bookingFindFirstMock).toHaveBeenCalledTimes(1);
    });

    it("tracks the limit per customer, not globally", async () => {
      vi.stubEnv("RATE_LIMIT_REVIEW_CREATE_MAX", "1");
      bookingFindFirstMock.mockResolvedValue({ id: BOOKING_ID, providerId: PROVIDER_ID, status: "COMPLETED", review: null });
      canReviewBookingMock.mockReturnValue(true);
      reviewCreateMock.mockResolvedValue({ id: "new-review" });

      requireCustomerMock.mockResolvedValue({ customer: { id: CUSTOMER_ID } });
      const first = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));
      expect(first).toEqual({ ok: true });

      requireCustomerMock.mockResolvedValue({ customer: { id: "a-different-customer-id" } });
      const second = await createReview(BOOKING_ID, formData({ rating: "5", content: "Great experience!" }));
      expect(second).toEqual({ ok: true });
    });
  });
});
