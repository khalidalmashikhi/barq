import "server-only";

// Provider service-action error codes — Phase 4.2 (Provider
// Experience). Same shape as src/lib/booking/booking-action-errors.ts:
// stable, locale-neutral, machine-readable codes shared across every
// Experience Management action (create/edit/publish/unpublish/archive/
// duplicate) — never displayed directly. Kept in the "provider"
// translation namespace (not the shared errors.json), mirroring the
// Phase 4.1 admin precedent (admin.json's own error keys), since these
// codes are exclusively provider-facing, not shared with any customer
// flow the way booking errors are.

export type ServiceActionErrorCode =
  | "INVALID_INPUT"
  | "NO_PROVIDER_PROFILE"
  | "PROVIDER_NOT_APPROVED"
  | "SERVICE_NOT_FOUND"
  | "NO_ACTIVE_PRICE"
  // Task B (Service→Category): the submitted categoryId is not an assignable
  // (effectively-PUBLIC, serviceType-matching) category.
  | "INVALID_CATEGORY"
  // Task B (BR-026): a publish was attempted on an uncategorized service.
  | "SERVICE_CATEGORY_REQUIRED"
  | "INVALID_STATUS_TRANSITION"
  | "UNKNOWN_ERROR";

const SERVICE_ACTION_ERROR_CODES: readonly ServiceActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_PROVIDER_PROFILE",
  "PROVIDER_NOT_APPROVED",
  "SERVICE_NOT_FOUND",
  "NO_ACTIVE_PRICE",
  "INVALID_CATEGORY",
  "SERVICE_CATEGORY_REQUIRED",
  "INVALID_STATUS_TRANSITION",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as
// isBookingActionErrorCode(): an incoming `?error=` value is arbitrary
// client-controllable input; an unrecognized value shows no message.
export function isServiceActionErrorCode(value: unknown): value is ServiceActionErrorCode {
  return typeof value === "string" && (SERVICE_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const SERVICE_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "serviceErrorInvalidInput",
  NO_PROVIDER_PROFILE: "serviceErrorNoProviderProfile",
  PROVIDER_NOT_APPROVED: "serviceErrorProviderNotApproved",
  SERVICE_NOT_FOUND: "serviceErrorNotFound",
  NO_ACTIVE_PRICE: "serviceErrorNoActivePrice",
  INVALID_CATEGORY: "serviceErrorInvalidCategory",
  SERVICE_CATEGORY_REQUIRED: "serviceErrorCategoryRequired",
  INVALID_STATUS_TRANSITION: "serviceErrorInvalidTransition",
  UNKNOWN_ERROR: "serviceErrorUnknown",
} as const satisfies Record<ServiceActionErrorCode, string>;

export function getServiceErrorTranslationKey(code: ServiceActionErrorCode) {
  return SERVICE_ERROR_TRANSLATION_KEYS[code];
}
