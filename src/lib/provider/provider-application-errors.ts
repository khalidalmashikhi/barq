import "server-only";

// Provider application error codes — Phase 5.1 (Production Readiness:
// self-service signup). Same stable, locale-neutral, machine-readable
// convention as service-action-errors.ts/booking-action-errors.ts —
// never displayed directly; getProviderApplicationErrorTranslationKey
// maps each one to a translation key.

// NOT_REJECTED — resubmitProviderApplication() rejected the transition because
// the caller's provider is not currently REJECTED (stale/concurrent action, or
// the provider is not in a resubmittable state). Reuses this same self-service
// error set the /provider-application page already renders.
export type ProviderApplicationErrorCode =
  | "INVALID_INPUT"
  | "ALREADY_HAS_PROVIDER_PROFILE"
  | "NOT_REJECTED"
  | "UNKNOWN_ERROR";

const PROVIDER_APPLICATION_ERROR_CODES: readonly ProviderApplicationErrorCode[] = [
  "INVALID_INPUT",
  "ALREADY_HAS_PROVIDER_PROFILE",
  "NOT_REJECTED",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — see service-action-errors.ts's
// identical note; an incoming `?error=` value is arbitrary
// client-controllable input.
export function isProviderApplicationErrorCode(value: unknown): value is ProviderApplicationErrorCode {
  return typeof value === "string" && (PROVIDER_APPLICATION_ERROR_CODES as readonly string[]).includes(value);
}

const TRANSLATION_KEYS = {
  INVALID_INPUT: "applicationErrorInvalidInput",
  ALREADY_HAS_PROVIDER_PROFILE: "applicationErrorAlreadyApplied",
  NOT_REJECTED: "applicationErrorNotRejected",
  UNKNOWN_ERROR: "applicationErrorUnknown",
} as const satisfies Record<ProviderApplicationErrorCode, string>;

export function getProviderApplicationErrorTranslationKey(code: ProviderApplicationErrorCode) {
  return TRANSLATION_KEYS[code];
}
