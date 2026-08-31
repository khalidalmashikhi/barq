import "server-only";

// REVIEW TRUST & SAFETY — the typed error codes for admin review moderation, mirroring every sibling
// *-admin-errors.ts module (a stable, locale-neutral union + a runtime guard + a translation-key map
// in the "admin" namespace). moderateReview() returns these; the admin page renders them via
// getServerTranslator("admin") through the same ?error= + <Alert> pattern the other admin surfaces use.

export type ReviewAdminActionErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "REVIEW_NOT_FOUND"
  // The requested action is not applicable to the review's current moderation state (e.g. flagging
  // an already-flagged review, or restoring one that is already public). A deliberate, safe
  // non-actionable outcome — never an arbitrary state write.
  | "INVALID_TRANSITION"
  // A concurrent moderator changed the review's state between our read and our guarded write — the
  // guarded updateMany matched no row. The admin re-reads the (now-current) state and retries.
  | "MODERATION_CONFLICT"
  | "UNKNOWN_ERROR";

const REVIEW_ADMIN_ACTION_ERROR_CODES: readonly ReviewAdminActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "REVIEW_NOT_FOUND",
  "INVALID_TRANSITION",
  "MODERATION_CONFLICT",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — an incoming `?error=` value is arbitrary client input; an
// unrecognized value shows no message (same discipline as every sibling module).
export function isReviewAdminActionErrorCode(value: unknown): value is ReviewAdminActionErrorCode {
  return typeof value === "string" && (REVIEW_ADMIN_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const REVIEW_ADMIN_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "reviewErrorInvalidInput",
  NO_ADMIN_PROFILE: "reviewErrorNoAdminProfile",
  REVIEW_NOT_FOUND: "reviewErrorNotFound",
  INVALID_TRANSITION: "reviewErrorInvalidTransition",
  MODERATION_CONFLICT: "reviewErrorConflict",
  UNKNOWN_ERROR: "reviewErrorUnknown",
} as const satisfies Record<ReviewAdminActionErrorCode, string>;

export function getReviewAdminErrorTranslationKey(code: ReviewAdminActionErrorCode) {
  return REVIEW_ADMIN_ERROR_TRANSLATION_KEYS[code];
}
