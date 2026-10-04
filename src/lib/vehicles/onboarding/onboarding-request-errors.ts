// Phase 3C Slice 3B — the two outcomes that belong to the onboarding REQUEST itself (not to the
// uploaded file). Pure and isomorphic: shared by the server result, the route's status mapping and
// the upload form's messages.
//
//   ONBOARDING_CANCELLED   — terminal. This request (or the setup it produced) was cancelled; its
//                            key can never create or resume anything. The provider must start a new
//                            setup explicitly.
//   ONBOARDING_IN_PROGRESS — another attempt with the same key is still being processed; retrying
//                            with the SAME key later returns its result.

export const ONBOARDING_REQUEST_ERROR_CODES = ["ONBOARDING_CANCELLED", "ONBOARDING_IN_PROGRESS"] as const;

export type OnboardingRequestErrorCode = (typeof ONBOARDING_REQUEST_ERROR_CODES)[number];

export function isOnboardingRequestErrorCode(value: unknown): value is OnboardingRequestErrorCode {
  return typeof value === "string" && (ONBOARDING_REQUEST_ERROR_CODES as readonly string[]).includes(value);
}

const TRANSLATION_KEYS = {
  ONBOARDING_CANCELLED: "vehicleOnboardErrCancelled",
  ONBOARDING_IN_PROGRESS: "vehicleOnboardErrInProgress",
} as const satisfies Record<OnboardingRequestErrorCode, string>;

export type OnboardingRequestErrorTranslationKey = (typeof TRANSLATION_KEYS)[OnboardingRequestErrorCode];

/** Provider-namespace translation key for a request-level outcome. */
export function getOnboardingRequestErrorTranslationKey(code: OnboardingRequestErrorCode): OnboardingRequestErrorTranslationKey {
  return TRANSLATION_KEYS[code];
}
