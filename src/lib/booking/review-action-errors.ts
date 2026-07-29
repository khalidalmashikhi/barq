import "server-only";

// Review creation error codes — Marketplace Completion (Review
// Creation Flow).
//
// A SEPARATE union from BookingActionErrorCode, deliberately: unlike
// create-booking.ts/cancel-booking.ts (which explicitly share one union
// per a past instruction, since 3 of their 9 codes are genuinely the
// same failure mode), review creation introduces codes with no booking-
// lifecycle equivalent (INVALID_RATING, INVALID_CONTENT,
// ALREADY_REVIEWED) — forcing them into the booking union would blur
// two distinct vocabularies for no shared benefit. Genuinely identical
// failure modes (INVALID_INPUT, NO_CUSTOMER_PROFILE, BOOKING_NOT_FOUND,
// UNKNOWN_ERROR) reuse the exact same errors.json translation keys as
// the booking union via review-error-messages.ts, so no meaning is
// duplicated — only the wire-code vocabulary is kept separate.
//
// STABLE, LOCALE-NEUTRAL, MACHINE-READABLE — same convention as
// BookingActionErrorCode: never displayed directly, only ever mapped
// through review-error-messages.ts.

export type ReviewActionErrorCode =
  | "INVALID_INPUT"
  | "NO_CUSTOMER_PROFILE"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_REVIEWABLE"
  | "ALREADY_REVIEWED"
  | "INVALID_RATING"
  | "INVALID_CONTENT"
  | "RATE_LIMITED"
  | "UNKNOWN_ERROR";

const REVIEW_ACTION_ERROR_CODES: readonly ReviewActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_CUSTOMER_PROFILE",
  "BOOKING_NOT_FOUND",
  "BOOKING_NOT_REVIEWABLE",
  "ALREADY_REVIEWED",
  "INVALID_RATING",
  "INVALID_CONTENT",
  "RATE_LIMITED",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same rule as isBookingActionErrorCode():
// an incoming `?error=` value is arbitrary client-controllable input.
export function isReviewActionErrorCode(value: unknown): value is ReviewActionErrorCode {
  return typeof value === "string" && (REVIEW_ACTION_ERROR_CODES as readonly string[]).includes(value);
}
