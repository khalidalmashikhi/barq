import "server-only";

// Feature Flag action error codes — Phase 1.3 (Core Business Platform).
// Same shape as category-errors.ts: stable, locale-neutral, machine-
// readable codes shared across every Feature Flag admin action — never
// displayed directly.

export type FeatureFlagActionErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "FLAG_NOT_FOUND"
  | "KEY_TAKEN"
  | "UNKNOWN_ERROR";

const FEATURE_FLAG_ACTION_ERROR_CODES: readonly FeatureFlagActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "FLAG_NOT_FOUND",
  "KEY_TAKEN",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as
// isCategoryActionErrorCode(): an incoming `?error=` value is arbitrary
// client-controllable input; an unrecognized value shows no message.
export function isFeatureFlagActionErrorCode(value: unknown): value is FeatureFlagActionErrorCode {
  return typeof value === "string" && (FEATURE_FLAG_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const FEATURE_FLAG_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "featureFlagErrorInvalidInput",
  NO_ADMIN_PROFILE: "featureFlagErrorNoAdminProfile",
  FLAG_NOT_FOUND: "featureFlagErrorNotFound",
  KEY_TAKEN: "featureFlagErrorKeyTaken",
  UNKNOWN_ERROR: "featureFlagErrorUnknown",
} as const satisfies Record<FeatureFlagActionErrorCode, string>;

export function getFeatureFlagErrorTranslationKey(code: FeatureFlagActionErrorCode) {
  return FEATURE_FLAG_ERROR_TRANSLATION_KEYS[code];
}
