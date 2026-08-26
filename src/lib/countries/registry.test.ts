import { describe, it, expect } from "vitest";
import { getCountries } from "libphonenumber-js";
import { COUNTRIES, DEFAULT_COUNTRY, findCountryByIso } from "./registry";
import { resolveAuthPhone } from "@/components/auth/phone-entry";

// AUTH-INTERNATIONAL-COUNTRY-COVERAGE-1 — the registry is now DERIVED from
// libphonenumber-js (full coverage) + Intl.DisplayNames (names), not a 52-country
// curated subset. These pin: full coverage, Oman default, every-continent presence,
// shared calling codes (+1), well-formed rows, and unchanged E.164 normalization.

describe("registry — full international coverage", () => {
  it("covers every libphonenumber-js country (no curated subset)", () => {
    const supported = getCountries().length;
    // All entries have a calling code, so none are filtered out in practice.
    expect(COUNTRIES.length).toBe(supported);
    expect(COUNTRIES.length).toBeGreaterThan(200);
  });

  it("Oman is the default and the first entry", () => {
    expect(DEFAULT_COUNTRY.iso).toBe("OM");
    expect(DEFAULT_COUNTRY.callingCode).toBe("+968");
    expect(COUNTRIES[0]!.iso).toBe("OM");
  });

  it("includes representative countries on every continent", () => {
    const isos = new Set(COUNTRIES.map((c) => c.iso));
    const expected = [
      "SA", "AE", "QA", "KW", "BH", // GCC / Middle East
      "GB", "DE", "FR", "SE", // Europe
      "JP", "IN", "CN", "TH", // Asia
      "KE", "NG", "ZA", "EG", // Africa
      "US", "CA", "BR", "MX", // Americas
      "AU", "NZ", "FJ", // Oceania
    ];
    for (const iso of expected) expect(isos.has(iso)).toBe(true);
  });

  it("every row is well-formed (ISO, +calling code, non-empty EN/AR names, auth-supported)", () => {
    for (const c of COUNTRIES) {
      expect(c.iso).toMatch(/^[A-Z]{2}$/);
      expect(c.callingCode).toMatch(/^\+\d+$/);
      expect(c.nameEn.trim()).not.toBe("");
      expect(c.nameAr.trim()).not.toBe("");
      expect(c.authSupported).toBe(true);
    }
  });

  it("has no duplicate ISO codes", () => {
    expect(new Set(COUNTRIES.map((c) => c.iso)).size).toBe(COUNTRIES.length);
  });

  it("findCountryByIso is case-insensitive", () => {
    expect(findCountryByIso("gb")?.iso).toBe("GB");
    expect(findCountryByIso("GB")?.iso).toBe("GB");
    expect(findCountryByIso("zz")).toBeUndefined();
  });
});

describe("registry — shared calling codes are distinct by ISO (+1 NANP)", () => {
  it("US, Canada, and a Caribbean NANP territory all share +1 but are distinct rows", () => {
    const us = findCountryByIso("US")!;
    const ca = findCountryByIso("CA")!;
    const jm = findCountryByIso("JM")!;
    expect(us.callingCode).toBe("+1");
    expect(ca.callingCode).toBe("+1");
    expect(jm.callingCode).toBe("+1");
    expect(new Set([us.iso, ca.iso, jm.iso]).size).toBe(3);
  });

  it("the ISO (not the shared code) drives national validation: US vs CA differ", () => {
    // A valid Canadian number and a valid US number each canonicalize under their own
    // ISO region — the +1 code alone never fuses them.
    expect(resolveAuthPhone(findCountryByIso("CA")!, "4165551234")).toEqual({ ok: true, e164: "+14165551234" });
    expect(resolveAuthPhone(findCountryByIso("US")!, "2125551234")).toEqual({ ok: true, e164: "+12125551234" });
  });
});

describe("registry — E.164 normalization across continents (unchanged authority)", () => {
  const cases: Array<[string, string, string]> = [
    ["OM", "98115159", "+96898115159"],
    ["SA", "512345678", "+966512345678"],
    ["AE", "501234567", "+971501234567"],
    ["GB", "7911123456", "+447911123456"],
    ["US", "2125551234", "+12125551234"],
    ["FR", "612345678", "+33612345678"],
    ["JP", "9012345678", "+819012345678"],
    ["IN", "9123456789", "+919123456789"],
    ["ZA", "821234567", "+27821234567"],
    ["NG", "8021234567", "+2348021234567"],
    ["BR", "11987654321", "+5511987654321"],
    ["AU", "412345678", "+61412345678"],
    ["NZ", "211234567", "+64211234567"],
  ];
  it.each(cases)("%s national number resolves to canonical E.164", (iso, national, e164) => {
    expect(resolveAuthPhone(findCountryByIso(iso)!, national)).toEqual({ ok: true, e164 });
  });
});
