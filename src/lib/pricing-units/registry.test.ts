import { describe, it, expect } from "vitest";
import { PRICING_UNIT_CODES, isValidPricingUnit, parsePricingUnit } from "./registry";

// Core Service Enrichment, Gate 3 — the pricing-unit registry is the ONLY
// allow-list for Price.pricingUnit (the DB deliberately has no CHECK). These
// tests pin the exact governed set, reject speculative/localized values, and
// prove the three-state parse contract. pricingUnit is display metadata only —
// none of this affects totals or booking behaviour.

describe("PRICING_UNIT_CODES", () => {
  it("is exactly the 6 governed pricing units (PER_VEHICLE added by Pricing Foundation)", () => {
    expect([...PRICING_UNIT_CODES]).toEqual(["PER_PERSON", "PER_BOOKING", "PER_DAY", "PER_HOUR", "PER_TRIP", "PER_VEHICLE"]);
  });

  it("has no duplicate codes", () => {
    expect(new Set(PRICING_UNIT_CODES).size).toBe(PRICING_UNIT_CODES.length);
  });
});

describe("isValidPricingUnit", () => {
  it("accepts every governed unit", () => {
    for (const code of PRICING_UNIT_CODES) {
      expect(isValidPricingUnit(code)).toBe(true);
    }
  });

  it("accepts PER_VEHICLE (governed since Pricing Foundation)", () => {
    expect(isValidPricingUnit("PER_VEHICLE")).toBe(true);
  });

  it("rejects speculative units not yet in the registry", () => {
    expect(isValidPricingUnit("PER_NIGHT")).toBe(false);
    expect(isValidPricingUnit("PER_ITEM")).toBe(false);
    expect(isValidPricingUnit("PER_PACKAGE")).toBe(false);
  });

  it("rejects localized labels, wrong casing, empty string, and non-strings", () => {
    expect(isValidPricingUnit("per person")).toBe(false);
    expect(isValidPricingUnit("لكل شخص")).toBe(false);
    expect(isValidPricingUnit("per_day")).toBe(false);
    expect(isValidPricingUnit("")).toBe(false);
    expect(isValidPricingUnit(null)).toBe(false);
    expect(isValidPricingUnit(undefined)).toBe(false);
    expect(isValidPricingUnit(42)).toBe(false);
  });
});

describe("parsePricingUnit", () => {
  it("returns null for absent/empty/whitespace input (unset)", () => {
    expect(parsePricingUnit(null)).toBeNull();
    expect(parsePricingUnit(undefined)).toBeNull();
    expect(parsePricingUnit("")).toBeNull();
    expect(parsePricingUnit("   ")).toBeNull();
  });

  it("returns the governed unit (trimmed) for a valid value", () => {
    expect(parsePricingUnit("PER_PERSON")).toBe("PER_PERSON");
    expect(parsePricingUnit("  PER_DAY  ")).toBe("PER_DAY");
  });

  it("returns undefined (invalid) for a non-empty, non-governed value", () => {
    expect(parsePricingUnit("PER_NIGHT")).toBeUndefined();
    expect(parsePricingUnit("per person")).toBeUndefined();
    expect(parsePricingUnit(42)).toBeUndefined();
    expect(parsePricingUnit({})).toBeUndefined();
  });
});
