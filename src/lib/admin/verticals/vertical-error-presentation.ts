import type { VerticalErrorCode } from "@/lib/provider/verticals/vertical-policy";

// Phase 3B — Phase 1. Presentation-only mapping from the canonical VerticalErrorCode to an admin
// message key (admin.json). Same NEVER-TRUST-QUERY-PARAMS discipline as the other admin error
// mappers: an incoming ?verticalError= value is validated before use; an unrecognized value shows
// no message.

const VERTICAL_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "verticalErrorInvalidInput",
  INVALID_VERTICAL: "verticalErrorInvalidVertical",
  VERTICAL_NOT_REQUESTED: "verticalErrorNotRequested",
  VERTICAL_NOT_APPROVED: "verticalErrorNotApproved",
  VERTICAL_REJECTED_OR_SUSPENDED: "verticalErrorRejectedOrSuspended",
  VERTICAL_ALREADY_EXISTS: "verticalErrorAlreadyExists",
  VERTICAL_DOCUMENTS_INCOMPLETE: "verticalErrorDocumentsIncomplete",
  VERTICAL_POLICY_NOT_CONFIGURED: "verticalErrorPolicyNotConfigured",
  VERTICAL_NOT_FOUND: "verticalErrorNotFound",
  VERTICAL_STATE_CONFLICT: "verticalErrorStateConflict",
  NO_PROVIDER_PROFILE: "verticalErrorNoProviderProfile",
  PROVIDER_NOT_ELIGIBLE: "verticalErrorProviderNotEligible",
  FORBIDDEN: "verticalErrorForbidden",
  UNKNOWN_ERROR: "verticalErrorUnknown",
} as const satisfies Record<VerticalErrorCode, string>;

export function isVerticalErrorCode(value: unknown): value is VerticalErrorCode {
  return typeof value === "string" && value in VERTICAL_ERROR_TRANSLATION_KEYS;
}

// No return annotation on purpose: the `as const` map makes the inferred return the literal
// key union, which is assignable to next-intl's NamespacedMessageKeys (a plain `string` is not).
export function getVerticalErrorTranslationKey(code: VerticalErrorCode) {
  return VERTICAL_ERROR_TRANSLATION_KEYS[code];
}
