import { describe, it, expect } from "vitest";
import { PRICING_UNIT_CODES } from "./registry";
import { PRICING_UNIT_LABEL_KEYS, pricingUnitLabelKey } from "./labels";

// Core Service Enrichment, Gate 4 — the pricing-unit presentation bridge. Since
// pricingUnit has NO DB CHECK, pricingUnitLabelKey is the ONLY guard preventing an
// unexpected stored string from leaking into presentation.

describe("PRICING_UNIT_LABEL_KEYS", () => {
  it("has a `common` namespace label key for every governed unit code", () => {
    for (const code of PRICING_UNIT_CODES) {
      expect(PRICING_UNIT_LABEL_KEYS[code]).toBe(`pricingUnit.${code}`);
    }
  });

  it("covers exactly the registry codes (no extra, no missing)", () => {
    expect(Object.keys(PRICING_UNIT_LABEL_KEYS).sort()).toEqual([...PRICING_UNIT_CODES].sort());
  });
});

describe("pricingUnitLabelKey", () => {
  it("returns the label key for a governed unit", () => {
    expect(pricingUnitLabelKey("PER_PERSON")).toBe("pricingUnit.PER_PERSON");
    expect(pricingUnitLabelKey("PER_DAY")).toBe("pricingUnit.PER_DAY");
  });

  it("returns null for null/undefined/empty (absent → price shown without a unit)", () => {
    expect(pricingUnitLabelKey(null)).toBeNull();
    expect(pricingUnitLabelKey(undefined)).toBeNull();
    expect(pricingUnitLabelKey("")).toBeNull();
  });

  it("returns null for an unknown/invalid unit (never leaks a raw string)", () => {
    expect(pricingUnitLabelKey("PER_NIGHT")).toBeNull();
    expect(pricingUnitLabelKey("per person")).toBeNull();
    expect(pricingUnitLabelKey("PER_DAYS")).toBeNull();
  });
});
