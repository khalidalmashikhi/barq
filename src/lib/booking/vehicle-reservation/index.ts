// BOOKING-CONFLICT-1A — vehicle-reservation domain barrel. The conflict foundation:
// a durable per-vehicle occupancy record plus the race-safe reserve / release primitives.
// Nothing writes to it until BOOKING-CONFLICT-1B integrates acceptBooking.
export { reservationIntervalsOverlap } from "./overlap";
export { acquireVehicleReservationLock } from "./advisory-lock";
export {
  reserveVehicleForBooking,
  type ReserveVehicleInput,
  type ReserveVehicleResult,
} from "./reserve-vehicle";
export { releaseVehicleReservationForBooking } from "./release-vehicle-reservation";
export { findBusyVehicleIdsForInterval } from "./find-busy-vehicles";
