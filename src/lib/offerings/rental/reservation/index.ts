import "server-only";

// Phase 3C Slice C3/E1 — the daily-rental vehicle/day RESERVATION authority (server-only). The public
// surface: atomic hold acquisition, the read-only conflict reader (integrated into the C2c calendar),
// voluntary release, and the bounded stale-hold expiry primitive. Confirmation (HELD→CONFIRMED) is
// DEFERRED to C3/E2, where it composes with Booking creation — see 17-CHANGELOG-DECISIONS.md.

export * from "./reservation-types";
export { acquireDailyRentalHold, type AcquireDailyRentalHoldParams } from "./acquire-daily-rental-hold";
export { getDailyRentalVehicleConflicts, rentalConflictKey } from "./daily-rental-conflicts";
export { releaseDailyRentalHold, type ReleaseDailyRentalHoldResult } from "./release-daily-rental-hold";
export {
  expireStaleDailyRentalHolds,
  expireStaleHoldsForVehicleDates,
  EXPIRE_STALE_HOLDS_DEFAULT_LIMIT,
} from "./expire-stale-daily-rental-holds";
