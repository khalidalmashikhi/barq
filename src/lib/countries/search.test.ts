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

  it("does not match unrelated countries for an Oman-specific query", () => {
    const byName = searchCountries("Oman");
    expect(byName.every((c) => c.iso === "OM")).toBe(true);
  });

  it("still supports other countries (global-ready): 'Germany', 'ألمانيا', 'DE', '+49' find Germany", () => {
    expect(isoOf(searchCountries("Germany"))).toContain("DE");
    expect(isoOf(searchCountries("ألمانيا"))).toContain("DE");
    expect(isoOf(searchCountries("DE"))).toContain("DE");
    expect(isoOf(searchCountries("+49"))).toContain("DE");
  });
});
