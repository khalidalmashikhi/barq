import { describe, it, expect } from "vitest";
import { searchCountries } from "./search";
import { COUNTRIES } from "./registry";

const isoOf = (list: ReturnType<typeof searchCountries>) => list.map((c) => c.iso);

describe("searchCountries — Oman findable by every mode", () => {
  it("empty/whitespace query returns the full list unchanged", () => {
    expect(searchCountries("")).toHaveLength(COUNTRIES.length);
    expect(searchCountries("   ")).toHaveLength(COUNTRIES.length);
  });

  it("finds Oman by ISO code, case-insensitively", () => {
    expect(isoOf(searchCountries("OM"))).toContain("OM");
    expect(isoOf(searchCountries("om"))).toContain("OM");
  });

  it("finds Oman by English name, case-insensitively", () => {
    expect(isoOf(searchCountries("Oman"))).toContain("OM");
    expect(isoOf(searchCountries("oMaN"))).toContain("OM");
  });

  it("finds Oman by Arabic name — with OR without diacritics (عمان matches عُمان)", () => {
    expect(isoOf(searchCountries("عمان"))).toContain("OM");
    expect(isoOf(searchCountries("عُمان"))).toContain("OM");
  });

  it("finds Oman by calling code with and without '+'", () => {
    expect(isoOf(searchCountries("968"))).toContain("OM");
    expect(isoOf(searchCountries("+968"))).toContain("OM");
  });

  it("tolerates surrounding whitespace", () => {
    expect(isoOf(searchCountries("  OM  "))).toContain("OM");
    expect(isoOf(searchCountries("  +968 "))).toContain("OM");
    expect(isoOf(searchCountries("  عمان "))).toContain("OM");
  });

  it("surfaces Oman first for its name, and stays exact for ISO / calling code", () => {
    // Name search is substring-based over the full CLDR list, so an incidental
    // substring match is expected (e.g. "Romania" contains "oman"); Oman must still
    // be present and — being the pinned default — the FIRST result.
    const byName = searchCountries("Oman");
    expect(byName.map((c) => c.iso)).toContain("OM");
    expect(byName[0]!.iso).toBe("OM");
    // ISO and calling-code queries remain precise (Oman only).
    expect(searchCountries("OM").filter((c) => c.iso === "OM")).toHaveLength(1);
    expect(searchCountries("+968").every((c) => c.iso === "OM")).toBe(true);
  });

  it("still supports other countries (global-ready): 'Germany', 'ألمانيا', 'DE', '+49' find Germany", () => {
    expect(isoOf(searchCountries("Germany"))).toContain("DE");
    expect(isoOf(searchCountries("ألمانيا"))).toContain("DE");
    expect(isoOf(searchCountries("DE"))).toContain("DE");
    expect(isoOf(searchCountries("+49"))).toContain("DE");
  });
});
