import { isValidPricingUnit, type PricingUnit } from "./registry";

// Pricing-unit presentation mapping (Core Service Enrichment, Gate 4).
//
// Mirrors regions/labels.ts exactly: the registry stays authoritative for
// VALIDITY, i18n for the human-readable LABEL, and this module is the single
// bridge (unit CODE -> `common` namespace translation key). Centralized so cards,
// detail, preview, and forms never hand-roll a code->label switch (Gate 4, item
// 12). pricingUnit remains DISPLAY METADATA ONLY — nothing here affects totals or
// booking behaviour.
//
// Isomorphic (no "server-only").
export const PRICING_UNIT_LABEL_KEYS = {
  PER_PERSON: "pricingUnit.PER_PERSON",
  PER_BOOKING: "pricingUnit.PER_BOOKING",
  PER_DAY: "pricingUnit.PER_DAY",
  PER_HOUR: "pricingUnit.PER_HOUR",
  PER_TRIP: "pricingUnit.PER_TRIP",
  PER_VEHICLE: "pricingUnit.PER_VEHICLE",
} as const satisfies Record<PricingUnit, string>;

export type PricingUnitLabelKey = (typeof PRICING_UNIT_LABEL_KEYS)[PricingUnit];

// Safe code -> label-key resolution. Returns the translation key for a governed
// unit, or null for null/absent/UNKNOWN values. pricingUnit has NO DB CHECK, so
// this guard is the ONLY thing preventing an unexpected stored string from
// leaking into presentation — an unknown unit gracefully omits the unit rather
// than rendering raw text (Gate 4, item 21).
export function pricingUnitLabelKey(code: string | null | undefined): PricingUnitLabelKey | null {
  return code && isValidPricingUnit(code) ? PRICING_UNIT_LABEL_KEYS[code] : null;
}
