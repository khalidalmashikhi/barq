import "server-only";

// Category/SubCategory action error codes — Phase 1.1 (Core Business
// Platform). Same shape as service-action-errors.ts: stable, locale-neutral,
// machine-readable codes shared across every Category/SubCategory admin
// action — never displayed directly.

export type CategoryActionErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "CATEGORY_NOT_FOUND"
  | "SUBCATEGORY_NOT_FOUND"
  | "SLUG_TAKEN"
  | "INVALID_VISIBILITY_TRANSITION"
  | "INVALID_SCHEDULED_DATE"
  | "UNKNOWN_ERROR";

const CATEGORY_ACTION_ERROR_CODES: readonly CategoryActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "CATEGORY_NOT_FOUND",
  "SUBCATEGORY_NOT_FOUND",
  "SLUG_TAKEN",
  "INVALID_VISIBILITY_TRANSITION",
  "INVALID_SCHEDULED_DATE",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as
// isServiceActionErrorCode(): an incoming `?error=` value is arbitrary
// client-controllable input; an unrecognized value shows no message.
export function isCategoryActionErrorCode(value: unknown): value is CategoryActionErrorCode {
  return typeof value === "string" && (CATEGORY_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const CATEGORY_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "categoryErrorInvalidInput",
  NO_ADMIN_PROFILE: "categoryErrorNoAdminProfile",
  CATEGORY_NOT_FOUND: "categoryErrorNotFound",
  SUBCATEGORY_NOT_FOUND: "categoryErrorSubcategoryNotFound",
  SLUG_TAKEN: "categoryErrorSlugTaken",
  INVALID_VISIBILITY_TRANSITION: "categoryErrorInvalidTransition",
  INVALID_SCHEDULED_DATE: "categoryErrorInvalidScheduledDate",
  UNKNOWN_ERROR: "categoryErrorUnknown",
} as const satisfies Record<CategoryActionErrorCode, string>;

export function getCategoryErrorTranslationKey(code: CategoryActionErrorCode) {
  return CATEGORY_ERROR_TRANSLATION_KEYS[code];
}
