// TOUR-VEHICLE-CAP — the SINGLE authoritative reader for a vehicle's TOUR-relevant
// capabilities. Pure / no I/O, so provider UI, admin UI, DTOs, and the future TOUR
// assignment eligibility all share ONE source of truth — never a competing copy.
//
// 4x4 TRUST MODEL (mirrors LC6's claimed-vs-trusted expiry): `claimedFourByFour` is a
// PROVIDER declaration (advisory); `fourByFourVerified` is the ADMIN-confirmed trusted
// fact and is the ONLY value that may decide GUIDE_WITH_4X4 eligibility. Capability is
// NEVER inferred from make/model or vehicleType — SUV is NOT 4x4, and a FOUR_BY_FOUR
// vehicleType code is itself provider-declared classification, not verified drivetrain.
// Fail-closed: unknown/undeclared (null) or explicitly-false → NOT capable.
//
// CAPACITY SEMANTIC (locked): `passengerCapacity` is the number of CUSTOMER/GUEST
// passengers — it EXCLUDES the driver and the provider/guide occupying a seat as
// operator. It is NOT the total physical / manufacturer seat count. A 7-seat vehicle
// driven by the provider carries 6 guests. This is the value a future TOUR rule will
// compare against a customer party size (partySize <= guest capacity). Legacy rows
// predate this semantic and must be reviewed before TOUR assignment.

export type VehicleFourByFourInput = {
  /** Admin-confirmed trusted 4x4 capability. Null = not yet verified. */
  fourByFourVerified: boolean | null;
};

/**
 * The authoritative "is this vehicle verified as 4x4-capable?" answer for
 * GUIDE_WITH_4X4 eligibility. Uses ONLY the trusted admin-confirmed field. Returns
 * true iff `fourByFourVerified === true`; false for `false`, `null`, or `undefined`
 * (fail-closed). Never reads a provider claim, make/model, or vehicleType.
 */
export function isVehicleFourByFourCapable(vehicle: VehicleFourByFourInput): boolean {
  return vehicle.fourByFourVerified === true;
}

/**
 * The vehicle's GUEST/CUSTOMER passenger capacity (excludes driver + operating
 * guide). Returns null when unknown. A future TOUR rule enforces
 * `partySize <= getVehicleGuestCapacity(...)`. This helper does NOT add or subtract a
 * driver seat — the stored value is already the guest count by the locked semantic.
 */
export function getVehicleGuestCapacity(vehicle: { passengerCapacity: number | null }): number | null {
  return vehicle.passengerCapacity;
}
