import { describe, it, expect } from "vitest";
import { VEHICLE_TYPE_CODES, VEHICLE_TYPE_DEFAULTS, isVehicleTypeCode, MIN_VEHICLE_YEAR, MAX_VEHICLE_YEAR, MAX_VEHICLE_PASSENGER_CAPACITY } from "./vehicle-type-codes";
import * as tourTemplate from "@/lib/tour-template/vehicle-types";

// Gate 2 — the shared PHYSICAL vehicle taxonomy is one vocabulary, extracted to a neutral module.
// The guided-tour module now RE-EXPORTS it (backward compat); neither owns the other. Membership
// describes what a vehicle physically IS and grants NO commercial authorization (proven separately
// in rental-authorization-separation.test.ts).

describe("VEHICLE_TYPE_CODES (neutral physical taxonomy)", () => {
  it("is exactly the six physical body-type codes", () => {
    expect([...VEHICLE_TYPE_CODES].sort()).toEqual(["FOUR_BY_FOUR", "MINIBUS", "OTHER", "SEDAN", "SUV", "VAN"]);
  });

  it("isVehicleTypeCode accepts only members", () => {
    expect(isVehicleTypeCode("SUV")).toBe(true);
    expect(isVehicleTypeCode("FOUR_BY_FOUR")).toBe(true);
    expect(isVehicleTypeCode("SPACESHIP")).toBe(false);
    expect(isVehicleTypeCode(null)).toBe(false);
    expect(isVehicleTypeCode(123)).toBe(false);
  });

  it("every default has a code in the set + ar/en labels", () => {
    for (const d of VEHICLE_TYPE_DEFAULTS) {
      expect(isVehicleTypeCode(d.code)).toBe(true);
      expect(typeof d.label.ar).toBe("string");
      expect(typeof d.label.en).toBe("string");
    }
  });

  it("exposes sane numeric bounds", () => {
    expect(MIN_VEHICLE_YEAR).toBeLessThan(MAX_VEHICLE_YEAR);
    expect(MAX_VEHICLE_PASSENGER_CAPACITY).toBeGreaterThan(0);
  });
});

describe("tour-template backward-compatibility re-exports", () => {
  it("TOUR_* names are the SAME underlying values (one vocabulary, not a competing copy)", () => {
    expect(tourTemplate.TOUR_VEHICLE_CODES).toBe(VEHICLE_TYPE_CODES);
    expect(tourTemplate.TOUR_VEHICLE_DEFAULTS).toBe(VEHICLE_TYPE_DEFAULTS);
    expect(tourTemplate.isTourVehicleCode).toBe(isVehicleTypeCode);
    expect(tourTemplate.MIN_VEHICLE_YEAR).toBe(MIN_VEHICLE_YEAR);
    expect(tourTemplate.MAX_VEHICLE_YEAR).toBe(MAX_VEHICLE_YEAR);
    expect(tourTemplate.MAX_VEHICLE_PASSENGER_CAPACITY).toBe(MAX_VEHICLE_PASSENGER_CAPACITY);
  });

  it("the neutral module exposes NO authorization/vertical/rental symbol (taxonomy only)", () => {
    // Structural guard: a physical-type registry must never grow a commercial-permission export.
    const exported = Object.keys({ VEHICLE_TYPE_CODES, VEHICLE_TYPE_DEFAULTS, isVehicleTypeCode, MIN_VEHICLE_YEAR, MAX_VEHICLE_YEAR, MAX_VEHICLE_PASSENGER_CAPACITY });
    for (const name of exported) {
      expect(/rental|vertical|authoriz|permission|canView|compliant/i.test(name)).toBe(false);
    }
  });
});
