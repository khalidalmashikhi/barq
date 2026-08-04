import { describe, it, expect } from "vitest";
import {
  SERVICE_TYPE_KEYS,
  DEFAULT_SERVICE_TYPE_KEY,
  SERVICE_TYPE_LABEL_KEYS,
  isValidServiceTypeKey,
} from "./registry";

// Focused tests for the code-owned ServiceType registry (ADR-0015). This is
// the governance boundary: the set of verticals is fixed here, and every
// write path validates against it.

describe("ServiceType registry", () => {
  it("exposes exactly the six governed vertical keys", () => {
    expect([...SERVICE_TYPE_KEYS]).toEqual([
      "EXPERIENCE",
      "TRANSPORT",
      "ACCOMMODATION",
      "DINING",
      "EVENT",
      "RENTAL",
    ]);
  });

  it("has no duplicate keys", () => {
    expect(new Set(SERVICE_TYPE_KEYS).size).toBe(SERVICE_TYPE_KEYS.length);
  });

  it("defaults to EXPERIENCE (the only vertical with real behavior today)", () => {
    expect(DEFAULT_SERVICE_TYPE_KEY).toBe("EXPERIENCE");
    expect(isValidServiceTypeKey(DEFAULT_SERVICE_TYPE_KEY)).toBe(true);
  });

  it("has a label key for every vertical and no extras", () => {
    expect(Object.keys(SERVICE_TYPE_LABEL_KEYS).sort()).toEqual([...SERVICE_TYPE_KEYS].sort());
  });

  describe("isValidServiceTypeKey", () => {
    it("accepts every governed key", () => {
      for (const key of SERVICE_TYPE_KEYS) {
        expect(isValidServiceTypeKey(key)).toBe(true);
      }
    });

    it("rejects unknown, wrong-case, empty, and non-string values", () => {
      for (const bad of ["experience", "HOTEL", "", "  ", "TRANSPORTATION", null, undefined, 5, {}, ["EXPERIENCE"]]) {
        expect(isValidServiceTypeKey(bad)).toBe(false);
      }
    });

    // The CHECK constraint in the migration must stay in sync with this list;
    // this test documents the exact allowed set the DB constraint mirrors.
    it("matches the set the DB CHECK constraint enforces", () => {
      const dbAllowed = ["EXPERIENCE", "TRANSPORT", "ACCOMMODATION", "DINING", "EVENT", "RENTAL"];
      expect([...SERVICE_TYPE_KEYS].sort()).toEqual([...dbAllowed].sort());
    });
  });
});
