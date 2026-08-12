import { describe, it, expect } from "vitest";
import { REGION_CODES, isValidRegionCode, parseRegionCode } from "./registry";

// Core Service Enrichment, Gate 3 — the region registry is the application
// allow-list for Service.regionCode and MUST stay in sync with the Gate-2 DB
// CHECK (services_regionCode_check). These tests pin the exact governed set and
// prove localized names / empty strings are rejected (codes are language-neutral
// identifiers; presentation is i18n's job).

describe("REGION_CODES", () => {
  it("is exactly the 11 Oman governorate codes the DB CHECK enforces", () => {
    expect([...REGION_CODES]).toEqual([
      "MUSCAT",
      "DHOFAR",
      "MUSANDAM",
      "AL_BURAIMI",
      "AD_DAKHILIYAH",
      "AL_BATINAH_NORTH",
      "AL_BATINAH_SOUTH",
      "ASH_SHARQIYAH_NORTH",
      "ASH_SHARQIYAH_SOUTH",
      "ADH_DHAHIRAH",
      "AL_WUSTA",
    ]);
  });

  it("has no duplicate codes", () => {
    expect(new Set(REGION_CODES).size).toBe(REGION_CODES.length);
  });
});

describe("isValidRegionCode", () => {
  it("accepts every governed code", () => {
    for (const code of REGION_CODES) {
      expect(isValidRegionCode(code)).toBe(true);
    }
  });

  it("rejects localized display names (codes are language-neutral, not labels)", () => {
    expect(isValidRegionCode("Dhofar")).toBe(false);
    expect(isValidRegionCode("ظفار")).toBe(false);
    expect(isValidRegionCode("Muscat")).toBe(false);
    expect(isValidRegionCode("مسقط")).toBe(false);
  });

  it("rejects wrong casing, empty string, and non-strings", () => {
    expect(isValidRegionCode("muscat")).toBe(false);
    expect(isValidRegionCode("")).toBe(false);
    expect(isValidRegionCode("  MUSCAT  ")).toBe(false);
    expect(isValidRegionCode(null)).toBe(false);
    expect(isValidRegionCode(undefined)).toBe(false);
    expect(isValidRegionCode(123)).toBe(false);
  });
});

describe("parseRegionCode", () => {
  it("returns null for absent/empty/whitespace input (unset)", () => {
    expect(parseRegionCode(null)).toBeNull();
    expect(parseRegionCode(undefined)).toBeNull();
    expect(parseRegionCode("")).toBeNull();
    expect(parseRegionCode("   ")).toBeNull();
  });

  it("returns the governed code (trimmed) for a valid value", () => {
    expect(parseRegionCode("DHOFAR")).toBe("DHOFAR");
    expect(parseRegionCode("  MUSCAT  ")).toBe("MUSCAT");
  });

  it("returns undefined (invalid) for a non-empty, non-governed value", () => {
    expect(parseRegionCode("Dhofar")).toBeUndefined();
    expect(parseRegionCode("ظفار")).toBeUndefined();
    expect(parseRegionCode("ATLANTIS")).toBeUndefined();
    expect(parseRegionCode(123)).toBeUndefined();
    expect(parseRegionCode({})).toBeUndefined();
  });
});
