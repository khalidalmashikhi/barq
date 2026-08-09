import "server-only";

// Provider admin action error codes — Phase 2 (Provider Foundation).
// Same stable, locale-neutral, machine-readable convention as
// category-errors.ts/feature-flag-errors.ts/homepage-section-errors.ts:
// shared across every admin-side Provider action — never displayed
// directly. Kept separate from provider-application-errors.ts, which
// covers the pre-existing self-service apply-as-provider.ts flow and has
// a different, smaller code set.

// REASON_REQUIRED / PROVIDER_NOT_PENDING added for the Review/Reject/Resubmit
// lifecycle: rejectProvider() needs a mandatory-reason error and a
// not-in-a-rejectable-state error. PROVIDER_NOT_PENDING is also the code
// approveProvider() already returns (it previously had no rendered message on
// the admin detail page); adding it here only makes that pre-existing code
// display a message — it does not change approval behavior.
export type ProviderAdminActionErrorCode =
  | "INVALID_INPUT"
  | "REASON_REQUIRED"
  | "NO_ADMIN_PROFILE"
  | "PROVIDER_NOT_FOUND"
  | "PROVIDER_NOT_PENDING"
  | "USER_NOT_FOUND"
  | "USER_ALREADY_HAS_PROVIDER_PROFILE"
  | "SLUG_TAKEN"
  | "PROVIDER_NOT_APPROVED"
  | "INVALID_STATUS_TRANSITION"
  // INCOMPLETE_DOCUMENTS — the approval completeness gate (Gate 3): approveProvider()
  // returns this when required verification documents are missing or not yet
  // APPROVED. The admin UI shows the specific blockers proactively and disables
  // Approve, so this code is the defense-in-depth message for the race where
  // blockers appear between page render and click.
  | "INCOMPLETE_DOCUMENTS"
  | "UNKNOWN_ERROR";

const PROVIDER_ADMIN_ACTION_ERROR_CODES: readonly ProviderAdminActionErrorCode[] = [
  "INVALID_INPUT",
  "REASON_REQUIRED",
  "NO_ADMIN_PROFILE",
  "PROVIDER_NOT_FOUND",
  "PROVIDER_NOT_PENDING",
  "USER_NOT_FOUND",
  "USER_ALREADY_HAS_PROVIDER_PROFILE",
  "SLUG_TAKEN",
  "PROVIDER_NOT_APPROVED",
  "INVALID_STATUS_TRANSITION",
  "INCOMPLETE_DOCUMENTS",
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
  REASON_REQUIRED: "providerErrorReasonRequired",
  NO_ADMIN_PROFILE: "providerErrorNoAdminProfile",
  PROVIDER_NOT_FOUND: "providerErrorNotFound",
  PROVIDER_NOT_PENDING: "providerErrorNotPending",
  USER_NOT_FOUND: "providerErrorUserNotFound",
  USER_ALREADY_HAS_PROVIDER_PROFILE: "providerErrorUserAlreadyHasProfile",
  SLUG_TAKEN: "providerErrorSlugTaken",
  PROVIDER_NOT_APPROVED: "providerErrorNotApproved",
  INVALID_STATUS_TRANSITION: "providerErrorInvalidTransition",
  INCOMPLETE_DOCUMENTS: "providerErrorIncompleteDocuments",
  UNKNOWN_ERROR: "providerErrorUnknown",
} as const satisfies Record<ProviderAdminActionErrorCode, string>;

export function getProviderAdminErrorTranslationKey(code: ProviderAdminActionErrorCode) {
  return PROVIDER_ADMIN_ERROR_TRANSLATION_KEYS[code];
}
