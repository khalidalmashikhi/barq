import "server-only";
import type { ReviewActionErrorCode } from "./review-action-errors";

// Error-code → translation-key mapping layer — Marketplace Completion
// (Review Creation Flow). Mirrors booking-error-messages.ts's exact
// pattern and reuses that file's own errors.json keys for the 4 codes
// that are genuinely the same failure mode (INVALID_INPUT,
// NO_CUSTOMER_PROFILE, BOOKING_NOT_FOUND, UNKNOWN_ERROR) — only the 4
// review-specific codes get their own new keys.
//
// `satisfies Record<ReviewActionErrorCode, string>` keeps this
// exhaustive against the code union at compile time.

const REVIEW_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "invalidInput",
  NO_CUSTOMER_PROFILE: "noCustomerProfile",
  BOOKING_NOT_FOUND: "bookingNotFound",
  BOOKING_NOT_REVIEWABLE: "bookingNotReviewable",
  ALREADY_REVIEWED: "alreadyReviewed",
  INVALID_RATING: "invalidRating",
  INVALID_CONTENT: "invalidContent",
  RATE_LIMITED: "rateLimited",
  UNKNOWN_ERROR: "unknownError",
} as const satisfies Record<ReviewActionErrorCode, string>;

export function getReviewErrorTranslationKey(code: ReviewActionErrorCode) {
  return REVIEW_ERROR_TRANSLATION_KEYS[code];
}
