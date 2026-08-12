// Pricing-unit registry — the authoritative APPLICATION allow-list for
// Price.pricingUnit (Core Service Enrichment, Gate 3: domain read/write wiring).
//
// Unlike regionCode, the database DELIBERATELY has NO CHECK constraint on
// pricingUnit (see the Gate-2 migration note): its vocabulary is commercially
// extensible — future specialization may add PER_NIGHT / PER_VEHICLE / PER_ITEM /
// PER_PACKAGE without a schema migration. Therefore THIS registry is the ONLY
// allow-list, and every write path validates against it before persisting.
//
// pricingUnit is DISPLAY / COMMERCIAL METADATA ONLY. It records the basis of a
// Price.amount for PRESENTATION ("per person", "per day"). It does NOT affect
// totals or booking behaviour: it never multiplies by seats/days/hours, never
// feeds a total, and the booking/payment/refund/snapshot pipeline never reads it.
// Adding a code here changes only how a price is LABELLED, never how it is
// charged.
//
// Deliberately a String code registry, not a Prisma enum (ADR-0015), same as
// service-types/registry.ts. Isomorphic: NO "server-only", so a Gate-4 pricing
// <select> in a client component can import PRICING_UNIT_CODES directly.

export const PRICING_UNIT_CODES = [
  "PER_PERSON",
  "PER_BOOKING",
  "PER_DAY",
  "PER_HOUR",
  "PER_TRIP",
] as const;

export type PricingUnit = (typeof PRICING_UNIT_CODES)[number];

// Runtime type guard — the single source of truth for "is this a governed pricing
// unit?" (and, since the DB has no CHECK, the ONLY enforcement point). Rejects
// non-strings, localized labels, and anything outside the set.
export function isValidPricingUnit(value: unknown): value is PricingUnit {
  return typeof value === "string" && (PRICING_UNIT_CODES as readonly string[]).includes(value);
}

// Domain parse helper for the create/update service actions — see
// regions/registry.ts's parseRegionCode for the identical three-state contract:
//
//   - null        → absent or empty/whitespace → unset (create: no unit; update:
//                   an explicit clear of the active price's unit to NULL)
//   - a PricingUnit → a governed, valid code
//   - undefined   → a non-empty, non-governed value → caller rejects (INVALID_INPUT)
//
// NULL-tolerant by construction: legacy Price rows and unset fields yield null.
export function parsePricingUnit(value: unknown): PricingUnit | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return isValidPricingUnit(trimmed) ? trimmed : undefined;
}
