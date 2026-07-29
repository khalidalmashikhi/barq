"use server";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireCustomer, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { canReviewBooking } from "@/lib/booking/cancellation-policy";
import { notifyBookingEvent, resolveBookingParties } from "@/lib/booking/lifecycle/notify";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit/rate-limiter";
import { getReviewCreateRateLimit } from "@/lib/rate-limit/rate-limit-config";
import type { ReviewActionErrorCode } from "./review-action-errors";

// Create review — Marketplace Completion (Review Creation Flow).
//
// ELIGIBILITY, every check re-derived server-side, never trusted from
// the client — mirrors create-booking.ts's own "nothing from the
// client is trusted except which IDs were selected" principle:
//   1. Authenticated — requireCustomer(), same pattern as every other
//      customer-initiated booking action.
//   2. Ownership — booking is looked up scoped to
//      {id: bookingId, customerId: customer.id} in one query (same
//      "findFirst, not findUnique-then-check" pattern as
//      getBookingDetail()); a booking belonging to someone else is
//      indistinguishable from a nonexistent one (BOOKING_NOT_FOUND for
//      both — no ID-enumeration signal).
//   3. Status — canReviewBooking() (cancellation-policy.ts) requires
//      the booking's real, current status to be COMPLETED.
//   4. Service/provider linkage cannot be forged — serviceId/providerId
//      are read directly off the fetched Booking row, never accepted
//      as form input. There is no `serviceId`/`providerId` field in
//      this action's FormData contract at all — forging one is
//      structurally impossible, not merely rejected.
//   5. Not already reviewed — pre-checked via `booking.review` (a
//      cheap, user-friendly rejection before touching the database),
//      AND independently enforced by the real, race-safe backstop:
//      Review.bookingId is `@unique` in the schema (confirmed by
//      inspection — Booking.review is a one-to-one optional back-
//      relation), so Postgres itself will refuse a second concurrent
//      insert for the same booking regardless of what this pre-check
//      saw. That P2002 violation is caught below and mapped to the
//      same ALREADY_REVIEWED code — this is why no schema migration is
//      needed for race-safe duplicate prevention.
//   6. Service/provider existing — structurally guaranteed: Booking's
//      own serviceId/providerId foreign keys cannot reference a
//      deleted row (Prisma/Postgres FK integrity), so a fetched Booking
//      always has a real Service and Provider behind it. Not a runtime
//      check because there is nothing for one to catch.
//   7. Rating range — validated as an integer 1-5 (Rating.value's own
//      schema comment: "PROVISIONAL numeric range (assumed 1–5)" — not
//      database-enforced, so this is the one real gate for it).
//   8. Content — trimmed, required (Review.content is non-nullable),
//      bounded at 2000 characters (a plain, generous free-text limit;
//      no existing convention for review-length content to mirror, so
//      this is a new, conservative choice, not an assumed one).

export type CreateReviewResult = { ok: true } | { ok: false; error: ReviewActionErrorCode };

const MAX_CONTENT_LENGTH = 2000;

export async function createReview(bookingId: string, formData: FormData): Promise<CreateReviewResult> {
  if (!isValidUuid(bookingId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const ratingRaw = formData.get("rating");
  const contentRaw = formData.get("content");

  if (typeof ratingRaw !== "string" || typeof contentRaw !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const ratingValue = Number(ratingRaw);
  if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
    return { ok: false, error: "INVALID_RATING" };
  }

  const content = contentRaw.trim();
  if (!content || content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: "INVALID_CONTENT" };
  }

  let customer;
  try {
    const auth = await requireCustomer();
    customer = auth.customer;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_CUSTOMER_PROFILE" };
    }
    throw error;
  }

  // Production Hardening — Rate Limiting. Same convention as
  // create-booking.ts's own rate-limit check: keyed on the
  // authenticated customer's id, checked only after auth succeeds.
  const rateLimit = checkRateLimit(`review-create:${customer.id}`, getReviewCreateRateLimit());
  if (!rateLimit.allowed) {
    logger.warn("createReview.rate_limited", { customerId: customer.id, retryAfterSeconds: rateLimit.retryAfterSeconds });
    return { ok: false, error: "RATE_LIMITED" };
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, customerId: customer.id },
    include: { review: true },
  });

  if (!booking) {
    return { ok: false, error: "BOOKING_NOT_FOUND" };
  }

  if (!canReviewBooking(booking.status)) {
    return { ok: false, error: "BOOKING_NOT_REVIEWABLE" };
  }

  if (booking.review) {
    return { ok: false, error: "ALREADY_REVIEWED" };
  }

  try {
    await prisma.review.create({
      data: {
        bookingId: booking.id,
        customerId: customer.id,
        providerId: booking.providerId,
        content,
        rating: { create: { value: ratingValue } },
      },
    });
  } catch (error) {
    // The real, race-safe backstop — see the module comment above.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "ALREADY_REVIEWED" };
    }

    logger.error("createReview.unexpected_error", {
      bookingId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  // Provider Notifications & Operational Alerts phase — reached only
  // after the review above has actually committed. Best-effort, same
  // swallow-and-log policy as the booking lifecycle hooks
  // (dispatchLifecycleHook): a notification failure must never undo or
  // appear to undo an already-successful review.
  try {
    const { providerUserId } = await resolveBookingParties(booking.id);
    await notifyBookingEvent({ userId: providerUserId, bookingId: booking.id, kind: "NEW_REVIEW_RECEIVED" });
  } catch (error) {
    logger.error("createReview.notification_failed", {
      bookingId: booking.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return { ok: true };
}
