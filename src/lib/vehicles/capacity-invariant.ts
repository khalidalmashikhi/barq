// Phase 3C — Vehicle Registration Extraction & Privacy Boundary, Slice 1.
//
// The SINGLE, pure rule relating the two passenger figures a provider/admin work with:
//   • bookablePassengerCapacity — how many CUSTOMERS the provider permits to book
//     (excludes the driver + any operating guide);
//   • licensedPassengerCapacity — the OFFICIAL licensed passenger capacity from the Omani
//     vehicle registration ("عدد الركاب"), authoritative only once admin-confirmed.
//
// INVARIANT: a provider can never let MORE customers board than the vehicle is licensed to
// carry, so bookablePassengerCapacity <= licensedPassengerCapacity WHENEVER the licensed value
// is known. When licensedPassengerCapacity is null (not yet extracted/confirmed) this rule
// imposes nothing — exactly as the existing bookable <= registeredSeats check tolerates an
// unknown registered figure. It fails "open" ONLY on ABSENT data, never on a known bad pair.
//
// DISTINCT from the bookable <= registeredSeats check in vehicle-input.ts: registeredSeats is
// the whole-vehicle PHYSICAL seat count; licensedPassengerCapacity is the registration's
// OFFICIAL passenger figure. They are separate, legitimate ceilings — never conflated.
//
// Pure and isomorphic (no server-only, no I/O): unit-testable and reusable by the LATER
// extraction/confirm workflow and a future mobile API. Shipped INERT in Slice 1 — no caller
// writes licensedPassengerCapacity yet, so nothing invokes this at runtime. It exists so the
// confirm workflow, when it lands, enforces exactly ONE authoritative rule for this pair.

export type LicensedCapacityInvariantViolation = "BOOKABLE_EXCEEDS_LICENSED";

export type LicensedCapacityFacts = {
  bookablePassengerCapacity: number | null;
  licensedPassengerCapacity: number | null;
};

/**
 * Returns the violation code when BOTH values are known and bookable > licensed, else null.
 * A null on either side means "not applicable" (unknown) — never a violation.
 */
export function licensedCapacityInvariantViolation(
  facts: LicensedCapacityFacts,
): LicensedCapacityInvariantViolation | null {
  const bookable = facts.bookablePassengerCapacity;
  const licensed = facts.licensedPassengerCapacity;
  if (bookable === null || licensed === null) return null;
  return bookable > licensed ? "BOOKABLE_EXCEEDS_LICENSED" : null;
}

/** Convenience boolean: the pair is permitted (invariant satisfied, or not applicable). */
export function isBookableWithinLicensed(facts: LicensedCapacityFacts): boolean {
  return licensedCapacityInvariantViolation(facts) === null;
}
