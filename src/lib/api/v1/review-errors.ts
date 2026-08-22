import type { NextResponse } from "next/server";
import type { ReviewActionErrorCode } from "@/lib/booking/review-action-errors";
import type { Locale } from "@/i18n/locales";
import { apiError, type ApiErrorCode } from "./errors";

// REVIEW-API-1 — maps the EXISTING authoritative ReviewActionErrorCode (returned
// by createReview()) onto the API v1 error envelope. This ONLY translates a stable
// code to HTTP + wire shape; it never changes a domain meaning and never surfaces a
// raw exception string.
//
// WHY THIS IS NOT booking-errors.ts. ReviewActionErrorCode and BookingActionErrorCode
// are different unions with different members — four of the review codes
// (INVALID_RATING, INVALID_CONTENT, BOOKING_NOT_REVIEWABLE, ALREADY_REVIEWED) do not
// exist in the booking union at all, and most booking codes (SLOT_FULL,
// PRICE_UNAVAILABLE, BOOKING_NOT_CANCELLABLE, ...) can never come out of a review.
// Forcing one mapper to serve both would mean a Record keyed on a union neither
// caller fully satisfies, and would lose the exhaustiveness check below that makes
// a newly added review code a COMPILE error rather than a silent 500.
//
// BOOKING_NOT_FOUND -> NOT_FOUND (404) preserves the domain's anti-enumeration
// posture: createReview() returns that one code for a booking that does not exist
// AND for one belonging to another customer, so the API cannot tell them apart
// either. That is deliberate, not an oversight to tidy up.
//
// ALREADY_REVIEWED is 409, and it is the load-bearing code of this surface. Review
// creation is NOT idempotent — Review.bookingId is @unique, so a second insert is
// refused rather than silently accepted. A client whose first request committed but
// whose response was lost will see exactly this code on retry, and because one
// review per booking can only have been written by its own customer, receiving it
// is positive evidence that the review exists. That is what makes an unknown network
// outcome recoverable without a second read.

const CODE_MAP: Record<ReviewActionErrorCode, ApiErrorCode> = {
  INVALID_INPUT: "INVALID_INPUT",
  NO_CUSTOMER_PROFILE: "NO_CUSTOMER_PROFILE",
  BOOKING_NOT_FOUND: "NOT_FOUND",
  BOOKING_NOT_REVIEWABLE: "BOOKING_NOT_REVIEWABLE",
  ALREADY_REVIEWED: "ALREADY_REVIEWED",
  INVALID_RATING: "INVALID_RATING",
  INVALID_CONTENT: "INVALID_CONTENT",
  RATE_LIMITED: "RATE_LIMITED",
  // The domain's own "unexpected, already logged server-side" catch-all.
  UNKNOWN_ERROR: "INTERNAL_ERROR",
};

/** Resolve the API v1 error code for a domain ReviewActionErrorCode. */
export function toApiReviewErrorCode(code: ReviewActionErrorCode): ApiErrorCode {
  return CODE_MAP[code] ?? "INTERNAL_ERROR";
}

/** Build the API v1 error response for a domain ReviewActionErrorCode. */
export function reviewErrorResponse(code: ReviewActionErrorCode, locale: Locale): NextResponse {
  return apiError(toApiReviewErrorCode(code), { locale });
}
