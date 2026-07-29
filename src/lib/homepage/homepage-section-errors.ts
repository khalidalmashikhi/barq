import "server-only";

// Homepage Section action error codes — Phase 1.4 (Core Business
// Platform). Same shape as category-errors.ts / feature-flag-errors.ts:
// stable, locale-neutral, machine-readable codes shared across every
// Homepage Section admin action — never displayed directly.

export type HomepageSectionActionErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "SECTION_NOT_FOUND"
  | "KEY_TAKEN"
  | "UNKNOWN_ERROR";

const HOMEPAGE_SECTION_ACTION_ERROR_CODES: readonly HomepageSectionActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "SECTION_NOT_FOUND",
  "KEY_TAKEN",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as
// isCategoryActionErrorCode()/isFeatureFlagActionErrorCode(): an incoming
// `?error=` value is arbitrary client-controllable input; an unrecognized
// value shows no message.
export function isHomepageSectionActionErrorCode(value: unknown): value is HomepageSectionActionErrorCode {
  return typeof value === "string" && (HOMEPAGE_SECTION_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const HOMEPAGE_SECTION_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "homepageSectionErrorInvalidInput",
  NO_ADMIN_PROFILE: "homepageSectionErrorNoAdminProfile",
  SECTION_NOT_FOUND: "homepageSectionErrorNotFound",
  KEY_TAKEN: "homepageSectionErrorKeyTaken",
  UNKNOWN_ERROR: "homepageSectionErrorUnknown",
} as const satisfies Record<HomepageSectionActionErrorCode, string>;

export function getHomepageSectionErrorTranslationKey(code: HomepageSectionActionErrorCode) {
  return HOMEPAGE_SECTION_ERROR_TRANSLATION_KEYS[code];
}
