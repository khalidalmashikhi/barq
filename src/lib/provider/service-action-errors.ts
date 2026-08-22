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
  // Gate B5: the category is valid/assignable, but this provider is NOT
  // authorized for it (holds no SELF/ADMIN/LEGACY ProviderCategory link). Raised
  // on create, on re-categorization, and on publish — distinct from
  // INVALID_CATEGORY (which is about the category itself, not the provider).
  | "ACTIVITY_NOT_AUTHORIZED"
  // TOUR-1: guidingContent (smart tour-guide data) was supplied for a service
  // that is NOT smart-tour eligible (not INDIVIDUAL, or not the tourist-guide
  // category). Rejected — a client can never smuggle tour content onto a generic
  // or COMPANY service.
  | "TOUR_TEMPLATE_NOT_ELIGIBLE"
  // TOUR-1: supplied guidingContent failed the strict parseGuidingContent()
  // contract (unknown/private key, bad package/vehicle combo, out-of-bounds, ...).
  | "TOUR_TEMPLATE_INVALID"
  // TOUR-1: an eligible smart-tour service cannot be published without valid
  // guidingContent present (publish-time completeness).
  | "TOUR_TEMPLATE_REQUIRED"
  // TOUR-VEHICLE-2P: a transport tour (GUIDE_WITH_TRANSPORT / GUIDE_WITH_4X4) cannot be
  // published without at least one CURRENTLY ELIGIBLE pooled vehicle (publish-time
  // fulfillment completeness). Surfaced like the other publish blockers.
  | "TOUR_VEHICLE_POOL_REQUIRED"
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
  "ACTIVITY_NOT_AUTHORIZED",
  "TOUR_TEMPLATE_NOT_ELIGIBLE",
  "TOUR_TEMPLATE_INVALID",
  "TOUR_TEMPLATE_REQUIRED",
  "TOUR_VEHICLE_POOL_REQUIRED",
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
  ACTIVITY_NOT_AUTHORIZED: "serviceErrorActivityNotAuthorized",
  TOUR_TEMPLATE_NOT_ELIGIBLE: "serviceErrorTourNotEligible",
  TOUR_TEMPLATE_INVALID: "serviceErrorTourInvalid",
  TOUR_TEMPLATE_REQUIRED: "serviceErrorTourRequired",
  TOUR_VEHICLE_POOL_REQUIRED: "serviceErrorTourVehiclePoolRequired",
  INVALID_STATUS_TRANSITION: "serviceErrorInvalidTransition",
  UNKNOWN_ERROR: "serviceErrorUnknown",
} as const satisfies Record<ServiceActionErrorCode, string>;

export function getServiceErrorTranslationKey(code: ServiceActionErrorCode) {
  return SERVICE_ERROR_TRANSLATION_KEYS[code];
}
