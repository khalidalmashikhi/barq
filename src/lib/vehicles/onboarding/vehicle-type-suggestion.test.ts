import { describe, it, expect } from "vitest";
import { suggestVehicleType } from "./vehicle-type-suggestion";
import { isTourVehicleCode } from "@/lib/tour-template/vehicle-types";

describe("suggestVehicleType", () => {
  it("returns null for empty / nullish / whitespace input", () => {
    expect(suggestVehicleType(null)).toBeNull();
    expect(suggestVehicleType(undefined)).toBeNull();
    expect(suggestVehicleType("")).toBeNull();
    expect(suggestVehicleType("   ")).toBeNull();
  });

  it("maps confident English keywords to canonical codes", () => {
    expect(suggestVehicleType("Toyota Land Cruiser 4x4")).toBe("FOUR_BY_FOUR");
    expect(suggestVehicleType("Nissan Patrol SUV")).toBe("SUV");
    expect(suggestVehicleType("Toyota HiAce Minibus")).toBe("MINIBUS");
    expect(suggestVehicleType("Ford Transit Van")).toBe("VAN");
    expect(suggestVehicleType("Honda Accord Sedan")).toBe("SEDAN");
  });

  it("maps confident Arabic keywords to canonical codes", () => {
    expect(suggestVehicleType("تويوتا دفع رباعي")).toBe("FOUR_BY_FOUR");
    expect(suggestVehicleType("حافلة صغيرة")).toBe("MINIBUS");
    expect(suggestVehicleType("صالون")).toBe("SEDAN");
  });

  it("prefers the most specific match (4x4 over SUV)", () => {
    expect(suggestVehicleType("4x4 SUV")).toBe("FOUR_BY_FOUR");
  });

  it("returns null when ambiguous / no confident keyword (never guesses, never OTHER)", () => {
    expect(suggestVehicleType("Toyota Hilux")).toBeNull();
    expect(suggestVehicleType("some vehicle")).toBeNull();
    expect(suggestVehicleType("OTHER")).toBeNull();
  });

  it("only ever returns a canonical code or null", () => {
    for (const text of ["4x4", "suv", "van", "minibus", "sedan", "random text", ""]) {
      const r = suggestVehicleType(text);
      expect(r === null || isTourVehicleCode(r)).toBe(true);
    }
  });
});
