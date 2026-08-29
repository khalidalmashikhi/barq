import { PRICING_UNIT_CODES, isValidPricingUnit, type PricingUnit } from "./registry";

// PRICING FOUNDATION — how a pricing unit's price relates to the booking quantity.
// PURE and isomorphic (no server-only). This is the ONLY place that decides whether a
// unit multiplies by quantity, is fixed, or cannot yet be billed. It is INERT in this
// gate — no booking/payment/commission path consumes it (see the total calculator).
//
//   QUANTITY_BASED             — price × bookingQuantity (PER_PERSON).
//   FIXED                      — price × 1; passenger/booking count never multiplies it
//                                (PER_BOOKING = BARQ's flat/fixed price, PER_TRIP, PER_VEHICLE).
//   DURATION_BASED_UNSUPPORTED — needs a billable duration BARQ does not capture yet
//                                (PER_DAY, PER_HOUR). NOT derivable from Service.durationMinutes.
export type Billability = "QUANTITY_BASED" | "FIXED" | "DURATION_BASED_UNSUPPORTED";

// Exhaustive by construction: adding a code to the registry forces a mapping here
// (Record<PricingUnit, …>), so a new unit can never be silently unclassified.
const BILLABILITY: Record<PricingUnit, Billability> = {
  PER_PERSON: "QUANTITY_BASED",
  PER_BOOKING: "FIXED",
  PER_TRIP: "FIXED",
  PER_VEHICLE: "FIXED",
  PER_DAY: "DURATION_BASED_UNSUPPORTED",
  PER_HOUR: "DURATION_BASED_UNSUPPORTED",
};

/**
 * Classify a pricing-unit code's billability. FAIL-CLOSED: an unknown / ungoverned /
 * null code returns `null` — it is NEVER defaulted to FIXED (or anything else), so an
 * unexpected stored string can never be charged as though it were a known unit.
 */
export function classifyBillability(pricingUnit: string | null | undefined): Billability | null {
  return pricingUnit && isValidPricingUnit(pricingUnit) ? BILLABILITY[pricingUnit] : null;
}

/**
 * Whether a unit may be assigned to a NEW / newly-ACTIVE Price — i.e. a governed unit BARQ
 * can actually price a booking with (QUANTITY_BASED or FIXED). FAIL-CLOSED: NULL, empty,
 * unknown, and the reserved-but-unbillable duration units (PER_DAY/PER_HOUR) all return
 * false. This is the single authority every price-write path validates against so a new
 * active price can never be created unbookable. (Legacy rows keep their NULL — read-only.)
 */
export function isBookablePricingUnit(unit: string | null | undefined): unit is PricingUnit {
  const billability = classifyBillability(unit);
  return billability === "QUANTITY_BASED" || billability === "FIXED";
}

/** The governed units that a new active price may use (QUANTITY_BASED + FIXED), in registry
 *  order — the authoring dropdown offers exactly these, so the reserved duration units are
 *  never selectable for a bookable offering. */
export const BOOKABLE_PRICING_UNIT_CODES: readonly PricingUnit[] = PRICING_UNIT_CODES.filter((code) =>
  isBookablePricingUnit(code)
);
