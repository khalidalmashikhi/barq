import { describe, it, expect } from "vitest";
import { buildBookingVehicleSnapshot, parseBookingVehicleSnapshot } from "./booking-vehicle-snapshot";

// A full vehicle-ish row with private fields the builder must NEVER copy.
const SOURCE = {
  make: "Toyota",
  model: "Prado",
  modelYear: 2024,
  color: "White",
  passengerCapacity: 6,
  vehicleType: "SUV",
  fourByFourVerified: null as boolean | null,
  // private / non-allowlisted (present on a real row) — must not survive:
  registrationNumber: "OM 12345",
  verificationStatus: "APPROVED",
  claimedFourByFour: true,
  objectKey: "private/key",
  assetId: "veh-1",
};

describe("buildBookingVehicleSnapshot — BOOKING-VEHICLE-SNAPSHOT", () => {
  it("copies ONLY the allowlisted customer-safe fields (no private data, no extra keys)", () => {
    const snap = buildBookingVehicleSnapshot(SOURCE);
    expect(snap).toEqual({
      make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
      passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false,
    });
    expect(Object.keys(snap).sort()).toEqual(
      ["color", "isFourByFour", "make", "model", "modelYear", "passengerCapacity", "vehicleType"].sort()
    );
    const json = JSON.stringify(snap);
    for (const forbidden of ["registrationNumber", "OM 12345", "verificationStatus", "claimedFourByFour", "objectKey", "assetId", "fourByFourVerified"]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it("isFourByFour derives from the TRUSTED flag only", () => {
    expect(buildBookingVehicleSnapshot({ ...SOURCE, fourByFourVerified: true }).isFourByFour).toBe(true);
    expect(buildBookingVehicleSnapshot({ ...SOURCE, fourByFourVerified: false }).isFourByFour).toBe(false);
    expect(buildBookingVehicleSnapshot({ ...SOURCE, fourByFourVerified: null }).isFourByFour).toBe(false);
  });

  it("neither vehicleType FOUR_BY_FOUR nor SUV nor a provider claim implies trusted 4x4", () => {
    // FOUR_BY_FOUR type code with an untrusted flag → still false.
    expect(buildBookingVehicleSnapshot({ ...SOURCE, vehicleType: "FOUR_BY_FOUR", fourByFourVerified: null }).isFourByFour).toBe(false);
    // A provider claim alone → false (SOURCE already carries claimedFourByFour: true, which the
    // builder never reads; only the untrusted fourByFourVerified matters).
    expect(buildBookingVehicleSnapshot({ ...SOURCE, fourByFourVerified: false }).isFourByFour).toBe(false);
    // SUV → false.
    expect(buildBookingVehicleSnapshot({ ...SOURCE, vehicleType: "SUV", fourByFourVerified: null }).isFourByFour).toBe(false);
  });

  it("preserves passengerCapacity exactly (guest semantics), including null", () => {
    expect(buildBookingVehicleSnapshot({ ...SOURCE, passengerCapacity: 4 }).passengerCapacity).toBe(4);
    expect(buildBookingVehicleSnapshot({ ...SOURCE, passengerCapacity: null }).passengerCapacity).toBeNull();
  });

  it("is a detached copy — mutating the source afterwards never changes an already-built snapshot (immutability)", () => {
    const src = { ...SOURCE, make: "Toyota", model: "Prado", fourByFourVerified: true as boolean | null };
    const snap = buildBookingVehicleSnapshot(src);
    // Simulate a LATER live-vehicle edit.
    src.make = "Nissan";
    src.model = "Patrol";
    src.fourByFourVerified = false;
    src.passengerCapacity = 3;
    expect(snap).toEqual({
      make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
      passengerCapacity: 6, vehicleType: "SUV", isFourByFour: true,
    });
  });
});

describe("parseBookingVehicleSnapshot", () => {
  const valid = { make: "Toyota", model: "Prado", modelYear: 2024, color: "White", passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false };

  it("returns the typed snapshot for a valid stored value", () => {
    expect(parseBookingVehicleSnapshot(valid)).toEqual(valid);
  });

  it("returns null for null / legacy-absent", () => {
    expect(parseBookingVehicleSnapshot(null)).toBeNull();
    expect(parseBookingVehicleSnapshot(undefined)).toBeNull();
  });

  it("rejects a value carrying an unexpected/private key (strict) → null", () => {
    expect(parseBookingVehicleSnapshot({ ...valid, registrationNumber: "OM 12345" })).toBeNull();
  });

  it("rejects a malformed value (wrong types / missing field) → null", () => {
    expect(parseBookingVehicleSnapshot({ ...valid, isFourByFour: "yes" })).toBeNull();
    const { make: _omit, ...missing } = valid;
    void _omit;
    expect(parseBookingVehicleSnapshot(missing)).toBeNull();
  });
});
