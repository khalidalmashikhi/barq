import "server-only";

// Provider availability-action error codes — Phase 4.2 (Provider
// Experience), Priority 2. Same shape as service-action-errors.ts:
// stable, locale-neutral, machine-readable codes for every Availability
// mutation (create/edit/delete/bulk-create).

export type AvailabilityActionErrorCode =
  | "INVALID_INPUT"
  | "NO_PROVIDER_PROFILE"
  | "PROVIDER_NOT_APPROVED"
  | "SERVICE_NOT_FOUND"
  | "SLOT_NOT_FOUND"
  | "CAPACITY_BELOW_BOOKED"
  | "SLOT_HAS_BOOKINGS"
  | "UNKNOWN_ERROR";

const AVAILABILITY_ACTION_ERROR_CODES: readonly AvailabilityActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_PROVIDER_PROFILE",
  "PROVIDER_NOT_APPROVED",
  "SERVICE_NOT_FOUND",
  "SLOT_NOT_FOUND",
  "CAPACITY_BELOW_BOOKED",
  "SLOT_HAS_BOOKINGS",
  "UNKNOWN_ERROR",
];

export function isAvailabilityActionErrorCode(value: unknown): value is AvailabilityActionErrorCode {
  return typeof value === "string" && (AVAILABILITY_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const AVAILABILITY_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "availabilityErrorInvalidInput",
  NO_PROVIDER_PROFILE: "availabilityErrorNoProviderProfile",
  PROVIDER_NOT_APPROVED: "availabilityErrorProviderNotApproved",
  SERVICE_NOT_FOUND: "availabilityErrorServiceNotFound",
  SLOT_NOT_FOUND: "availabilityErrorSlotNotFound",
  CAPACITY_BELOW_BOOKED: "availabilityErrorCapacityBelowBooked",
  SLOT_HAS_BOOKINGS: "availabilityErrorSlotHasBookings",
  UNKNOWN_ERROR: "availabilityErrorUnknown",
} as const satisfies Record<AvailabilityActionErrorCode, string>;

export function getAvailabilityErrorTranslationKey(code: AvailabilityActionErrorCode) {
  return AVAILABILITY_ERROR_TRANSLATION_KEYS[code];
}
