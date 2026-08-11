import { describe, it, expect } from "vitest";
import { DISCOVERY_FAMILIES } from "./discovery-families";

// The homepage discovery model must stay in lockstep with the approved
// ADR-0016 v1 taxonomy — these slugs are what /services?category=<slug>
// resolves against.

describe("DISCOVERY_FAMILIES (ADR-0016 v1 discovery model)", () => {
  it("is exactly the 4 approved v1 families, in order", () => {
    expect(DISCOVERY_FAMILIES.map((f) => f.slug)).toEqual([
      "cars",
      "tours-experiences",
      "marine-trips",
      "transfers",
    ]);
  });

  it("has unique slugs and a landing label + description key + icon for each", () => {
    expect(new Set(DISCOVERY_FAMILIES.map((f) => f.slug)).size).toBe(DISCOVERY_FAMILIES.length);
    for (const f of DISCOVERY_FAMILIES) {
      expect(f.labelKey.startsWith("categories.")).toBe(true);
      expect(f.descKey.startsWith("categories.")).toBe(true);
      expect(f.Icon).toBeDefined();
    }
  });
});
