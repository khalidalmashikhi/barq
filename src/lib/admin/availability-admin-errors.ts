import "server-only";

// Availability admin action error codes — Phase 2.7 (Availability
// Foundation). Same stable, locale-neutral, machine-readable convention
// as price-admin-errors.ts/service-admin-errors.ts: shared across every
// admin-side Availability action — never displayed directly. Kept
// separate from src/lib/provider/availability-action-errors.ts, which
// covers the pre-existing self-service create/edit/delete/bulk-create
// flow (Phase 4.2) and has a different, provider-ownership-shaped code
// set (NO_PROVIDER_PROFILE/PROVIDER_NOT_APPROVED don't apply here — an
// admin isn't acting as a provider). INVALID_STATE_TRANSITION is new:
// the self-service flow never activates/deactivates a slot (it only
// ever hard-deletes), so no equivalent code existed to reuse.

export type AvailabilityAdminActionErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "SERVICE_NOT_FOUND"
  | "SLOT_NOT_FOUND"
  | "CAPACITY_BELOW_BOOKED"
  | "SLOT_HAS_BOOKINGS"
  | "INVALID_STATE_TRANSITION"
  | "UNKNOWN_ERROR";

const AVAILABILITY_ADMIN_ACTION_ERROR_CODES: readonly AvailabilityAdminActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "SERVICE_NOT_FOUND",
  "SLOT_NOT_FOUND",
  "CAPACITY_BELOW_BOOKED",
  "SLOT_HAS_BOOKINGS",
  "INVALID_STATE_TRANSITION",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as every sibling
// *-errors.ts module: an incoming `?error=` value is arbitrary
// client-controllable input; an unrecognized value shows no message.
export function isAvailabilityAdminActionErrorCode(value: unknown): value is AvailabilityAdminActionErrorCode {
  return typeof value === "string" && (AVAILABILITY_ADMIN_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const AVAILABILITY_ADMIN_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "availabilityErrorInvalidInput",
  NO_ADMIN_PROFILE: "availabilityErrorNoAdminProfile",
  SERVICE_NOT_FOUND: "availabilityErrorServiceNotFound",
  SLOT_NOT_FOUND: "availabilityErrorSlotNotFound",
  CAPACITY_BELOW_BOOKED: "availabilityErrorCapacityBelowBooked",
  SLOT_HAS_BOOKINGS: "availabilityErrorSlotHasBookings",
  INVALID_STATE_TRANSITION: "availabilityErrorInvalidTransition",
  UNKNOWN_ERROR: "availabilityErrorUnknown",
} as const satisfies Record<AvailabilityAdminActionErrorCode, string>;

export function getAvailabilityAdminErrorTranslationKey(code: AvailabilityAdminActionErrorCode) {
  return AVAILABILITY_ADMIN_ERROR_TRANSLATION_KEYS[code];
}
