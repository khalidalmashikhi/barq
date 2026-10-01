// Phase 3C Slice 3A — PURE validation of the capacity relationship on the provider's private
// CLAIM: bookablePassengerCapacity <= licensedPassengerCapacity <= registeredSeats, each pair
// checked ONLY when both values are present (a missing value never blocks — it warns upstream).
// This validates the private claim; it NEVER writes the authoritative Vehicle row.

export type CapacityClaim = {
  bookablePassengerCapacity: number | null;
  licensedPassengerCapacity: number | null;
  registeredSeats: number | null;
};

export type CapacityClaimViolation =
  | "BOOKABLE_EXCEEDS_LICENSED"
  | "LICENSED_EXCEEDS_REGISTERED"
  | "BOOKABLE_EXCEEDS_REGISTERED";

/** Returns every violated pair (empty when the known values are consistent). Absent values skip. */
export function capacityClaimViolations(claim: CapacityClaim): CapacityClaimViolation[] {
  const { bookablePassengerCapacity: b, licensedPassengerCapacity: l, registeredSeats: r } = claim;
  const out: CapacityClaimViolation[] = [];
  if (b !== null && l !== null && b > l) out.push("BOOKABLE_EXCEEDS_LICENSED");
  if (l !== null && r !== null && l > r) out.push("LICENSED_EXCEEDS_REGISTERED");
  if (b !== null && r !== null && b > r) out.push("BOOKABLE_EXCEEDS_REGISTERED");
  return out;
}

export function isCapacityClaimValid(claim: CapacityClaim): boolean {
  return capacityClaimViolations(claim).length === 0;
}
