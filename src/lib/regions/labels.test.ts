import { describe, it, expect } from "vitest";
import { REGION_CODES } from "./registry";
import { REGION_LABEL_KEYS, regionLabelKey } from "./labels";

// Core Service Enrichment, Gate 4 — the region presentation bridge. The registry
// stays authoritative for validity; these tests pin that every governed code has
// a label key and that unknown/absent values fail safe (null), so presentation
// never leaks a raw code.

describe("REGION_LABEL_KEYS", () => {
  it("has a `common` namespace label key for every governed governorate code", () => {
    for (const code of REGION_CODES) {
      expect(REGION_LABEL_KEYS[code]).toBe(`governorate.${code}`);
    }
  });

  it("covers exactly the registry codes (no extra, no missing)", () => {
    expect(Object.keys(REGION_LABEL_KEYS).sort()).toEqual([...REGION_CODES].sort());
  });
});

describe("regionLabelKey", () => {
  it("returns the label key for a governed code", () => {
    expect(regionLabelKey("DHOFAR")).toBe("governorate.DHOFAR");
    expect(regionLabelKey("MUSCAT")).toBe("governorate.MUSCAT");
  });

  it("returns null for null/undefined/empty (absent → omit)", () => {
    expect(regionLabelKey(null)).toBeNull();
    expect(regionLabelKey(undefined)).toBeNull();
    expect(regionLabelKey("")).toBeNull();
  });

  it("returns null for an unknown/invalid value (never leaks a raw string)", () => {
    expect(regionLabelKey("Dhofar")).toBeNull();
    expect(regionLabelKey("ATLANTIS")).toBeNull();
    expect(regionLabelKey("muscat")).toBeNull();
  });
});
