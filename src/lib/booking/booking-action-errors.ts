import "server-only";

// Booking action error codes — Internationalization Phase A.4.
//
// SINGLE SHARED UNION FOR BOTH create-booking.ts AND cancel-booking.ts,
// per explicit instruction — not two separate unions. 3 of the 9 codes
// (INVALID_INPUT, NO_CUSTOMER_PROFILE, UNKNOWN_ERROR) are genuinely the
// same failure mode regardless of which action triggered them;
// NO_CUSTOMER_PROFILE was already a de facto shared literal string in
// both files before this migration. The other 6 are inherently
// action-specific (a cancel can never produce SLOT_FULL; a create can
// never produce BOOKING_NOT_CANCELLABLE) — each action's own logic
// simply never returns the codes that don't apply to it.
//
// STABLE, LOCALE-NEUTRAL, MACHINE-READABLE: these values are never
// displayed directly — src/lib/booking/booking-error-messages.ts maps
// each one to a translation key; Server Actions themselves never
// return localized text after this migration.

export type BookingActionErrorCode =
  | "INVALID_INPUT"
  | "NO_CUSTOMER_PROFILE"
  | "NO_PROVIDER_PROFILE"
  | "SERVICE_UNAVAILABLE"
  | "PRICE_UNAVAILABLE"
  // BOOKING-SLOT-AUTHORITY — three DISTINCT slot failures, deliberately not merged:
  // SLOT_REQUIRED    the service is slot-based and the request supplied no slot at all
  // SLOT_UNAVAILABLE a slot WAS supplied but is foreign, not OPEN, or in the past
  // SLOT_FULL        a valid slot lost its remaining capacity in a race
  | "SLOT_REQUIRED"
  | "SLOT_UNAVAILABLE"
  | "SLOT_FULL"
  | "DUPLICATE_BOOKING"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_CANCELLABLE"
  | "BOOKING_NOT_PENDING"
  | "BOOKING_NOT_STARTABLE"
  | "BOOKING_NOT_COMPLETABLE"
  // BOOKING-VEHICLE-1 — provider acceptance vehicle-assignment outcomes. A transport
  // tour package requires a vehicle (VEHICLE_REQUIRED); the supplied vehicle must be in
  // this service's pool (VEHICLE_NOT_IN_SERVICE_POOL — also the uniform, non-enumerable
  // outcome for a foreign vehicle), currently eligible (VEHICLE_NOT_ELIGIBLE), and able to
  // carry the booking's party (VEHICLE_CAPACITY_INSUFFICIENT). BOOKING_STATE_CONFLICT is a
  // genuine concurrent-modification race (the booking left PENDING_PROVIDER between our read
  // and our guarded write) — distinct from BOOKING_NOT_PENDING, which is the up-front check.
  | "VEHICLE_REQUIRED"
  | "VEHICLE_NOT_IN_SERVICE_POOL"
  | "VEHICLE_NOT_ELIGIBLE"
  | "VEHICLE_CAPACITY_INSUFFICIENT"
  | "BOOKING_STATE_CONFLICT"
  | "RATE_LIMITED"
  | "UNKNOWN_ERROR";

const BOOKING_ACTION_ERROR_CODES: readonly BookingActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_CUSTOMER_PROFILE",
  "NO_PROVIDER_PROFILE",
  "SERVICE_UNAVAILABLE",
  "PRICE_UNAVAILABLE",
  "SLOT_REQUIRED",
  "SLOT_UNAVAILABLE",
  "SLOT_FULL",
  "DUPLICATE_BOOKING",
  "BOOKING_NOT_FOUND",
  "BOOKING_NOT_CANCELLABLE",
  "BOOKING_NOT_PENDING",
  "BOOKING_NOT_STARTABLE",
  "BOOKING_NOT_COMPLETABLE",
  "VEHICLE_REQUIRED",
  "VEHICLE_NOT_IN_SERVICE_POOL",
  "VEHICLE_NOT_ELIGIBLE",
  "VEHICLE_CAPACITY_INSUFFICIENT",
  "BOOKING_STATE_CONFLICT",
  "RATE_LIMITED",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS: an incoming `?error=` value is arbitrary
// client-controllable input — this is the one gate every caller must
// pass it through before treating it as a real code (and, downstream,
// before translating it). An unrecognized value is not a known failure
// mode, not `UNKNOWN_ERROR` either — callers show no message for it.
export function isBookingActionErrorCode(value: unknown): value is BookingActionErrorCode {
  return typeof value === "string" && (BOOKING_ACTION_ERROR_CODES as readonly string[]).includes(value);
}
