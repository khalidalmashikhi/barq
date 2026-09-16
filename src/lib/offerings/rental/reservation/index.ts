import "server-only";

// Phase 3C Slice C3/E1 + C3/E2 — the daily-rental vehicle/day RESERVATION authority (server-only).
// The public surface: atomic hold acquisition, the read-only conflict reader (integrated into the
// C2c calendar), voluntary release, the bounded stale-hold expiry primitive, the shared quote
// resolver, and (C3/E2) the CONFIRMED-reservation cancellation primitive that terminal-negative
// Booking transitions call. HELD→CONFIRMED itself lives in ../booking/confirm-daily-rental-hold.ts
// (it composes Booking creation).

export * from "./reservation-types";
export { acquireDailyRentalHold, type AcquireDailyRentalHoldParams } from "./acquire-daily-rental-hold";
export { getDailyRentalVehicleConflicts, rentalConflictKey } from "./daily-rental-conflicts";
export { releaseDailyRentalHold, type ReleaseDailyRentalHoldResult } from "./release-daily-rental-hold";
export {
  expireStaleDailyRentalHolds,
  expireStaleHoldsForVehicleDates,
  EXPIRE_STALE_HOLDS_DEFAULT_LIMIT,
} from "./expire-stale-daily-rental-holds";
export { resolveRentalDayQuote, type ResolveRentalDayQuoteResult } from "./resolve-rental-day-quote";
export { cancelConfirmedDailyRentalReservations } from "./cancel-confirmed-daily-rental-reservations";
