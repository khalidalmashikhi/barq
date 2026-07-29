import "server-only";

// Booking admin action error codes — Phase 2.9 (Booking Foundation).
// Same stable, locale-neutral, machine-readable convention as
// price-admin-errors.ts/availability-admin-errors.ts. Deliberately NOT
// merged with src/lib/booking/booking-action-errors.ts, which covers
// the pre-existing customer/provider-facing actions (create/cancel/
// accept/reject/start/complete) and carries codes that don't apply
// here (NO_CUSTOMER_PROFILE, SLOT_FULL, DUPLICATE_BOOKING — none of
// which an admin's read-only list/detail or cancellation can produce).
// BOOKING_NOT_CANCELLABLE reuses the exact same eligibility rule as the
// customer-facing action (see cancellation-policy.ts's canCancelBooking,
// unchanged) — an admin cannot cancel a booking a customer couldn't
// have cancelled themselves, since no new transition was added.

export type BookingAdminActionErrorCode =
  | "INVALID_INPUT"
  | "NO_ADMIN_PROFILE"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_NOT_CANCELLABLE"
  | "UNKNOWN_ERROR";

const BOOKING_ADMIN_ACTION_ERROR_CODES: readonly BookingAdminActionErrorCode[] = [
  "INVALID_INPUT",
  "NO_ADMIN_PROFILE",
  "BOOKING_NOT_FOUND",
  "BOOKING_NOT_CANCELLABLE",
  "UNKNOWN_ERROR",
];

// NEVER TRUST QUERY PARAMETERS — same discipline as every sibling
// *-errors.ts module: an incoming `?error=` value is arbitrary
// client-controllable input; an unrecognized value shows no message.
export function isBookingAdminActionErrorCode(value: unknown): value is BookingAdminActionErrorCode {
  return typeof value === "string" && (BOOKING_ADMIN_ACTION_ERROR_CODES as readonly string[]).includes(value);
}

const BOOKING_ADMIN_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "bookingErrorInvalidInput",
  NO_ADMIN_PROFILE: "bookingErrorNoAdminProfile",
  BOOKING_NOT_FOUND: "bookingErrorNotFound",
  BOOKING_NOT_CANCELLABLE: "bookingErrorNotCancellable",
  UNKNOWN_ERROR: "bookingErrorUnknown",
} as const satisfies Record<BookingAdminActionErrorCode, string>;

export function getBookingAdminErrorTranslationKey(code: BookingAdminActionErrorCode) {
  return BOOKING_ADMIN_ERROR_TRANSLATION_KEYS[code];
}
