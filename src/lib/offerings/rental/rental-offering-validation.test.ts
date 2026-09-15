import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { parseOfferingAmount, normalizeOfferingCurrency, checkCapacityOverride } from "./rental-offering-validation";

// Phase 3C Slice C2b-R — pure money / currency / capacity validation. Money is Decimal, 2dp,
// positive; never JS float. Capacity override is a positive-int party-size ceiling ≤ verified.

describe("parseOfferingAmount", () => {
  it("accepts canonical 0/1/2-dp positive strings and returns a Decimal", () => {
    for (const [raw, out] of [
      ["40", "40"],
      ["40.5", "40.5"],
      ["40.50", "40.5"],
      ["0.01", "0.01"],
      ["1000000.99", "1000000.99"],
    ] as const) {
      const d = parseOfferingAmount(raw);
      expect(d).toBeInstanceOf(Prisma.Decimal);
      expect(d!.equals(new Prisma.Decimal(out))).toBe(true);
    }
  });
  it("accepts a numeric input and trims surrounding whitespace on strings", () => {
    expect(parseOfferingAmount(40)!.equals(new Prisma.Decimal("40"))).toBe(true);
    expect(parseOfferingAmount("  25.25  ")!.equals(new Prisma.Decimal("25.25"))).toBe(true);
  });
  it("accepts a pre-built positive ≤2dp Decimal, rejects an over-precision one", () => {
    expect(parseOfferingAmount(new Prisma.Decimal("12.34"))).not.toBeNull();
    expect(parseOfferingAmount(new Prisma.Decimal("12.345"))).toBeNull();
  });
  it("rejects zero, negatives, >2dp, malformed, non-finite, and empty", () => {
    for (const bad of ["0", "0.00", "-1", "-0.01", "40.123", "40.", ".5", "1,000", "abc", "", " ", "NaN", "Infinity", "1e3"]) {
      expect(parseOfferingAmount(bad)).toBeNull();
    }
    expect(parseOfferingAmount(0)).toBeNull();
    expect(parseOfferingAmount(-5)).toBeNull();
    expect(parseOfferingAmount(NaN)).toBeNull();
    expect(parseOfferingAmount(Infinity)).toBeNull();
    expect(parseOfferingAmount(null)).toBeNull();
    expect(parseOfferingAmount(undefined)).toBeNull();
    expect(parseOfferingAmount({})).toBeNull();
  });
});

describe("normalizeOfferingCurrency", () => {
  it("trims + upper-cases a non-empty token (no ISO-format imposed)", () => {
    expect(normalizeOfferingCurrency("omr")).toBe("OMR");
    expect(normalizeOfferingCurrency("  usd ")).toBe("USD");
    expect(normalizeOfferingCurrency("Points")).toBe("POINTS"); // deliberately not ISO-restricted
  });
  it("rejects empty, whitespace-only, over-long, and non-strings", () => {
    expect(normalizeOfferingCurrency("")).toBeNull();
    expect(normalizeOfferingCurrency("   ")).toBeNull();
    expect(normalizeOfferingCurrency("ABCDEFGHIJK")).toBeNull(); // 11 chars > 10
    expect(normalizeOfferingCurrency(123 as unknown as string)).toBeNull();
    expect(normalizeOfferingCurrency(null as unknown as string)).toBeNull();
  });
});

describe("checkCapacityOverride", () => {
  it("null override → effective = verified capacity (may itself be null at draft time)", () => {
    expect(checkCapacityOverride(7, null)).toEqual({ ok: true, effectiveCapacity: 7 });
    expect(checkCapacityOverride(null, null)).toEqual({ ok: true, effectiveCapacity: null });
  });
  it("valid stricter override → effective = override", () => {
    expect(checkCapacityOverride(7, 4)).toEqual({ ok: true, effectiveCapacity: 4 });
    expect(checkCapacityOverride(7, 7)).toEqual({ ok: true, effectiveCapacity: 7 }); // equal is allowed
  });
  it("override above verified capacity is rejected (never widens the ceiling)", () => {
    expect(checkCapacityOverride(7, 8)).toEqual({ ok: false, error: "INVALID_CAPACITY_OVERRIDE" });
  });
  it("non-positive / non-integer override is rejected", () => {
    for (const bad of [0, -1, 2.5, NaN]) {
      expect(checkCapacityOverride(7, bad)).toEqual({ ok: false, error: "INVALID_CAPACITY_OVERRIDE" });
    }
  });
  it("an override with no verified capacity to bound it → VERIFIED_CAPACITY_MISSING", () => {
    expect(checkCapacityOverride(null, 4)).toEqual({ ok: false, error: "VERIFIED_CAPACITY_MISSING" });
    expect(checkCapacityOverride(0, 4)).toEqual({ ok: false, error: "VERIFIED_CAPACITY_MISSING" });
  });
});
