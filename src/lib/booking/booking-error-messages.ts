import "server-only";
import type { BookingActionErrorCode } from "./booking-action-errors";

// Error-code → translation-key mapping layer — Internationalization
// Phase A.4.
//
// THE ONLY PLACE THAT KNOWS WHICH errors.json KEY A CODE MAPS TO —
// callers never call t(code) directly (a code is not a translation
// key; conflating the two would make renaming either one a silent
// breakage). Keys are camelCase, matching every other namespace's
// convention (messages/*/errors.json), not the codes' own
// SCREAMING_SNAKE_CASE — deliberately not the same casing, so the two
// vocabularies (stable wire codes vs. translation keys) stay visibly
// distinct rather than looking like the same thing spelled two ways.
//
// `satisfies Record<BookingActionErrorCode, string>` keeps this
// exhaustive against the code union at compile time — adding a new
// code without adding its mapping here is a type error, not a silent
// runtime gap.

const BOOKING_ERROR_TRANSLATION_KEYS = {
  INVALID_INPUT: "invalidInput",
  NO_CUSTOMER_PROFILE: "noCustomerProfile",
  NO_PROVIDER_PROFILE: "noProviderProfile",
  SERVICE_UNAVAILABLE: "serviceUnavailable",
  PRICE_UNAVAILABLE: "priceUnavailable",
  SLOT_UNAVAILABLE: "slotUnavailable",
  SLOT_FULL: "slotFull",
  DUPLICATE_BOOKING: "duplicateBooking",
  BOOKING_NOT_FOUND: "bookingNotFound",
  BOOKING_NOT_CANCELLABLE: "bookingNotCancellable",
  BOOKING_NOT_PENDING: "bookingNotPending",
  BOOKING_NOT_STARTABLE: "bookingNotStartable",
  BOOKING_NOT_COMPLETABLE: "bookingNotCompletable",
  VEHICLE_REQUIRED: "vehicleRequired",
  VEHICLE_NOT_IN_SERVICE_POOL: "vehicleNotInServicePool",
  VEHICLE_NOT_ELIGIBLE: "vehicleNotEligible",
  VEHICLE_CAPACITY_INSUFFICIENT: "vehicleCapacityInsufficient",
  BOOKING_STATE_CONFLICT: "bookingStateConflict",
  RATE_LIMITED: "rateLimited",
  UNKNOWN_ERROR: "unknownError",
} as const satisfies Record<BookingActionErrorCode, string>;

export function getBookingErrorTranslationKey(code: BookingActionErrorCode) {
  return BOOKING_ERROR_TRANSLATION_KEYS[code];
}
