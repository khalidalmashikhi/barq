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
  // PLATFORM-CUSTOMER-CREDENTIALS-API-1 — the customer exists but has not completed
  // dual verification (a verified phone AND a real verified email). Distinct from
  // NO_CUSTOMER_PROFILE, which means there is no Customer row at all: this one is
  // actionable by the customer, and the API must say so rather than redirect.
  | "CUSTOMER_INCOMPLETE"
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
  // SERVICE INFORMATION MODEL — the requested seat count is outside the provider's per-booking
  // bounds for this service (minBookingSeats/maxBookingSeats). A per-BOOKING quantity rule,
  // distinct from SLOT_FULL (a slot's total capacity race).
  | "BOOKING_QUANTITY_OUT_OF_RANGE"
  // BOOKING TOTAL CALCULATION — the selected price's pricing unit cannot yet produce an
  // authoritative booking total: either a duration-based unit BARQ does not price yet
  // (PER_DAY/PER_HOUR) or a price with an unrecognized/NULL unit. Fail-closed: no booking is
  // created and the unit price is NEVER used as a substitute total. Customer-facing as a
  // generic "this pricing option is not bookable yet" (no internal calculator code leaks).
  | "PRICING_UNIT_NOT_BOOKABLE"
  | "DUPLICATE_BOOKING"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_CANCELLABLE"
  | "BOOKING_NOT_PENDING"
  | "BOOKING_NOT_STARTABLE"
  | "BOOKING_NOT_COMPLETABLE"
  // BOOKING FULFILLMENT LOGISTICS — the provider tried to set/clear booking-specific meeting
  // instructions on a booking that is not in an editable state. Instructions may be authored only
  // while the booking is CONFIRMED or IN_PROGRESS; every terminal/pre-acceptance status rejects
  // with this. A state guard, distinct from BOOKING_NOT_FOUND (ownership) and the transition-
  // specific BOOKING_NOT_PENDING/STARTABLE/COMPLETABLE codes.
  | "BOOKING_NOT_EDITABLE"
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
  // BOOKING-CONFLICT-1B — the vehicle the provider selected is already committed to another
  // active reservation whose operational window overlaps this booking's. Detected atomically
  // inside the acceptance transaction (per-vehicle advisory lock + overlap check); the whole
  // acceptance rolls back, so the booking stays PENDING_PROVIDER with no vehicle/payment.
  // Distinct from VEHICLE_NOT_ELIGIBLE (a property of the vehicle itself) — this is a
  // time-window conflict with a DIFFERENT booking, and reveals nothing about that booking.
  | "VEHICLE_BUSY"
  // BOOKING-INTERVAL-1 — provider acceptance operational-interval outcomes for a
  // vehicle-required booking. SCHEDULE_REQUIRED: a slotless vehicle-required booking has no
  // operational interval and the provider supplied none at acceptance. INVALID_SCHEDULE: a
  // schedule was supplied but is malformed (one-sided pair, non-date, or start >= end).
  // Distinct from SLOT_REQUIRED (the customer's create-time "no Availability slot" outcome).
  | "SCHEDULE_REQUIRED"
  | "INVALID_SCHEDULE"
  // DOWNSTREAM MONEY ALIGNMENT — a booking's money snapshot could not be resolved into an
  // authoritative amount to charge/record (a corrupt totalized snapshot, or no money at all).
  // Financial actions (accept/complete) FAIL CLOSED rather than charge from a bad snapshot or
  // silently downgrade to the unit price. Generic and customer/provider-safe — no resolver
  // internals leak.
  | "BOOKING_PRICING_INVALID"
  // BOOKING-IDEMPOTENCY — request-idempotency outcomes on booking CREATION.
  // IDEMPOTENCY_KEY_INVALID: a supplied idempotency key is malformed (bad length/charset) —
  // fail closed rather than silently ignore it. IDEMPOTENCY_KEY_CONFLICT: the SAME key was
  // already used by this customer for a materially DIFFERENT booking request (different
  // service/price/slot/quantity) — refuse rather than return the wrong booking. A same-key
  // same-request retry is NOT an error: it replays the original booking as an idempotent success.
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "RATE_LIMITED"
  | "UNKNOWN_ERROR";

const BOOKING_ACTION_ERROR_CODES: readonly BookingActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_CUSTOMER_PROFILE",
  "NO_PROVIDER_PROFILE",
  "SERVICE_UNAVAILABLE",
  "PRICE_UNAVAILABLE",
  "BOOKING_QUANTITY_OUT_OF_RANGE",
  "PRICING_UNIT_NOT_BOOKABLE",
  "SLOT_REQUIRED",
  "SLOT_UNAVAILABLE",
  "SLOT_FULL",
  "DUPLICATE_BOOKING",
  "BOOKING_NOT_FOUND",
  "BOOKING_NOT_CANCELLABLE",
  "BOOKING_NOT_PENDING",
  "BOOKING_NOT_STARTABLE",
  "BOOKING_NOT_COMPLETABLE",
  "BOOKING_NOT_EDITABLE",
  "VEHICLE_REQUIRED",
  "VEHICLE_NOT_IN_SERVICE_POOL",
  "VEHICLE_NOT_ELIGIBLE",
  "VEHICLE_CAPACITY_INSUFFICIENT",
  "BOOKING_STATE_CONFLICT",
  "VEHICLE_BUSY",
  "SCHEDULE_REQUIRED",
  "INVALID_SCHEDULE",
  "BOOKING_PRICING_INVALID",
  "IDEMPOTENCY_KEY_INVALID",
  "IDEMPOTENCY_KEY_CONFLICT",
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
