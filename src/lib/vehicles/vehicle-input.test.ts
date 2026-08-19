import { describe, it, expect } from "vitest";
import { parseVehicleInput, VEHICLE_TYPE_CODES } from "./vehicle-input";

const base = {
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR" as const,
  passengerCapacity: 6,
  publicDescription: "Comfortable desert-ready 4x4.",
  registrationNumber: null,
};

function parse(over: Record<string, unknown>) {
  return parseVehicleInput({ ...base, ...over });
}

describe("vehicleInputSchema — canonical vehicle types (reused registry)", () => {
  it("accepts every canonical supported code", () => {
    for (const code of VEHICLE_TYPE_CODES) {
      expect(parse({ vehicleType: code }).ok).toBe(true);
    }
    expect([...VEHICLE_TYPE_CODES].sort()).toEqual(["FOUR_BY_FOUR", "MINIBUS", "OTHER", "SEDAN", "SUV", "VAN"]);
  });

  it("rejects an unknown vehicle type (no competing vocabulary)", () => {
    expect(parse({ vehicleType: "SPACESHIP" }).ok).toBe(false);
    expect(parse({ vehicleType: "four_by_four" }).ok).toBe(false); // case-sensitive code
  });
});

describe("vehicleInputSchema — text normalization + bounds", () => {
  it("trims make/model and rejects empty-after-trim", () => {
    const r = parse({ make: "  Toyota  ", model: "  Hilux  " });
    expect(r.ok && r.value.make).toBe("Toyota");
    expect(r.ok && r.value.model).toBe("Hilux");
    expect(parse({ make: "   " }).ok).toBe(false);
    expect(parse({ model: "" }).ok).toBe(false);
  });

  it("rejects HTML/markup in text fields", () => {
    expect(parse({ make: "<b>Toyota</b>" }).ok).toBe(false);
    expect(parse({ publicDescription: "<script>x</script>" }).ok).toBe(false);
  });

  it("bounds passenger capacity (positive, sane max)", () => {
    expect(parse({ passengerCapacity: 0 }).ok).toBe(false);
    expect(parse({ passengerCapacity: -3 }).ok).toBe(false);
    expect(parse({ passengerCapacity: 101 }).ok).toBe(false);
    expect(parse({ passengerCapacity: 1 }).ok).toBe(true);
    expect(parse({ passengerCapacity: 6 }).ok).toBe(true);
  });

  it("bounds model year and allows null", () => {
    expect(parse({ modelYear: 1949 }).ok).toBe(false);
    expect(parse({ modelYear: 2101 }).ok).toBe(false);
    expect(parse({ modelYear: 2025 }).ok).toBe(true);
    expect(parse({ modelYear: null }).ok).toBe(true);
    const r = parse({ modelYear: undefined });
    expect(r.ok && r.value.modelYear).toBeNull();
  });

  it("treats color as optional (smallest sensible: null when absent)", () => {
    const r = parse({ color: "" });
    expect(r.ok && r.value.color).toBeNull();
    expect(parse({ color: undefined }).ok).toBe(true);
    expect(parse({ color: "Silver" }).ok).toBe(true);
  });
});

describe("vehicleInputSchema — private registration (optional, conservatively normalized)", () => {
  it("accepts an optional registration number and normalizes it (trim/collapse/upper)", () => {
    const r = parse({ registrationNumber: "  om 12345 " });
    expect(r.ok && r.value.registrationNumber).toBe("OM 12345");
  });

  it("normalizes blank/whitespace registration to null (multiple null-plate vehicles are allowed)", () => {
    expect(parse({ registrationNumber: "   " }).ok && parse({ registrationNumber: "   " }).ok).toBe(true);
    const a = parse({ registrationNumber: null });
    const b = parse({ registrationNumber: "" });
    expect(a.ok && a.value.registrationNumber).toBeNull();
    expect(b.ok && b.value.registrationNumber).toBeNull();
  });
});

describe("vehicleInputSchema — strictness", () => {
  it("rejects unknown keys (a client can never smuggle providerId / assetType / status)", () => {
    expect(parseVehicleInput({ ...base, providerId: "attacker" }).ok).toBe(false);
    expect(parseVehicleInput({ ...base, assetType: "VEHICLE" }).ok).toBe(false);
    expect(parseVehicleInput({ ...base, status: "ACTIVE" }).ok).toBe(false);
    expect(parseVehicleInput({ ...base, registrationNumberExtra: "x" }).ok).toBe(false);
  });

  it("requires make, model, vehicleType, passengerCapacity", () => {
    expect(parseVehicleInput({ model: "X", vehicleType: "SUV", passengerCapacity: 4 }).ok).toBe(false); // no make
    expect(parseVehicleInput({ make: "X", vehicleType: "SUV", passengerCapacity: 4 }).ok).toBe(false); // no model
    expect(parseVehicleInput({ make: "X", model: "Y", passengerCapacity: 4 }).ok).toBe(false); // no type
    expect(parseVehicleInput({ make: "X", model: "Y", vehicleType: "SUV" }).ok).toBe(false); // no capacity
  });
});
