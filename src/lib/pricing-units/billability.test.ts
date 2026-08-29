import { describe, it, expect } from "vitest";
import { classifyBillability } from "./billability";
import { PRICING_UNIT_CODES } from "./registry";

describe("classifyBillability", () => {
  it("maps PER_PERSON to QUANTITY_BASED", () => {
    expect(classifyBillability("PER_PERSON")).toBe("QUANTITY_BASED");
  });

  it("maps the fixed units to FIXED (passenger/booking count never multiplies)", () => {
    expect(classifyBillability("PER_BOOKING")).toBe("FIXED");
    expect(classifyBillability("PER_TRIP")).toBe("FIXED");
    expect(classifyBillability("PER_VEHICLE")).toBe("FIXED");
  });

  it("maps the duration units to DURATION_BASED_UNSUPPORTED", () => {
    expect(classifyBillability("PER_DAY")).toBe("DURATION_BASED_UNSUPPORTED");
    expect(classifyBillability("PER_HOUR")).toBe("DURATION_BASED_UNSUPPORTED");
  });

  it("FAILS CLOSED for unknown / ungoverned / null codes — never defaults to FIXED", () => {
    expect(classifyBillability("PER_NIGHT")).toBeNull();
    expect(classifyBillability("FLAT")).toBeNull();
    expect(classifyBillability("totally-made-up")).toBeNull();
    expect(classifyBillability("")).toBeNull();
    expect(classifyBillability(null)).toBeNull();
    expect(classifyBillability(undefined)).toBeNull();
  });

  it("classifies every governed registry code (no unit left unclassified)", () => {
    for (const code of PRICING_UNIT_CODES) {
      expect(classifyBillability(code)).not.toBeNull();
    }
  });
});
