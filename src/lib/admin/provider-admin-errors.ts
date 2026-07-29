import "server-only";

// Provider admin action error codes — Phase 2 (Provider Foundation).
// Same stable, locale-neutral, machine-readable convention as
// category-errors.ts/feature-flag-errors.ts/homepage-section-errors.ts:
// shared across every admin-side Provider action — never displayed
// directly. Kept separate from provider-application-errors.ts, which
// covers the pre-existing self-service apply-as-provider.ts flow and has
// a different, smaller code set.

export type ProviderAdminActionErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "PROVIDER_NOT_FOUND"
  | "USER_NOT_FOUND"
  | "USER_ALREADY_HAS_PROVIDER_PROFILE"
  | "SLUG_TAKEN"
  | "PROVIDER_NOT_APPROVED"
  | "INVALID_STATUS_TRANSITION"
  | "UNKNOWN_ERROR";

const PROVIDER_ADMIN_ACTION_ERROR_CODES: readonly ProviderAdminActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "PROVIDER_NOT_FOUND",
  "USER_NOT_FOUND",
  "USER_ALREADY_HAS_PROVIDER_PROFILE",
  "SLUG_TAKEN",
  "PROVIDER_NOT_APPROVED",
  "INVALID_STATUS_TRANSITION",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as every sibling
// *-errors.ts module: an incoming `?error=` value is arbitrary
// client-controllable input; an unrecognized value shows no message.
export function isProviderAdminActionErrorCode(value: unknown): value is ProviderAdminActionErrorCode {
  return typeof value === "string" && (PROVIDER_ADMIN_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const PROVIDER_ADMIN_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "providerErrorInvalidInput",
  NO_ADMIN_PROFILE: "providerErrorNoAdminProfile",
  PROVIDER_NOT_FOUND: "providerErrorNotFound",
  USER_NOT_FOUND: "providerErrorUserNotFound",
  USER_ALREADY_HAS_PROVIDER_PROFILE: "providerErrorUserAlreadyHasProfile",
  SLUG_TAKEN: "providerErrorSlugTaken",
  PROVIDER_NOT_APPROVED: "providerErrorNotApproved",
  INVALID_STATUS_TRANSITION: "providerErrorInvalidTransition",
  UNKNOWN_ERROR: "providerErrorUnknown",
} as const satisfies Record<ProviderAdminActionErrorCode, string>;

export function getProviderAdminErrorTranslationKey(code: ProviderAdminActionErrorCode) {
  return PROVIDER_ADMIN_ERROR_TRANSLATION_KEYS[code];
}
