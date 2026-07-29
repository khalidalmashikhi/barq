import "server-only";

// Provider Settings error codes — Provider Operations Foundation. Same
// shape as service-action-errors.ts/availability-action-errors.ts:
// stable, locale-neutral, machine-readable codes — never displayed
// directly.

export type ProviderProfileActionErrorCode = "INVALID_INPUT" | "NO_PROVIDER_PROFILE" | "UNKNOWN_ERROR";

const PROVIDER_PROFILE_ACTION_ERROR_CODES: readonly ProviderProfileActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_PROVIDER_PROFILE",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as
// isServiceActionErrorCode(): an incoming `?error=` value is arbitrary
// client-controllable input; an unrecognized value shows no message.
export function isProviderProfileActionErrorCode(value: unknown): value is ProviderProfileActionErrorCode {
  return typeof value === "string" && (PROVIDER_PROFILE_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const PROVIDER_PROFILE_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "profileErrorInvalidInput",
  NO_PROVIDER_PROFILE: "profileErrorNoProviderProfile",
  UNKNOWN_ERROR: "profileErrorUnknown",
} as const satisfies Record<ProviderProfileActionErrorCode, string>;

export function getProviderProfileErrorTranslationKey(code: ProviderProfileActionErrorCode) {
  return PROVIDER_PROFILE_ERROR_TRANSLATION_KEYS[code];
}
