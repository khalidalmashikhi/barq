import { describe, it, expect } from "vitest";
import { isVehicleFourByFourCapable, getVehicleGuestCapacity } from "./capability";
import { TOUR_PACKAGE_SEMANTICS } from "@/lib/tour-template/packages";

// TOUR-VEHICLE-CAP — the trusted-capability + guest-capacity truth table.

describe("isVehicleFourByFourCapable — trusted-only, fail-closed", () => {
  it("trusted true → capable", () => {
    expect(isVehicleFourByFourCapable({ fourByFourVerified: true })).toBe(true);
  });

  it("trusted false → NOT capable", () => {
    expect(isVehicleFourByFourCapable({ fourByFourVerified: false })).toBe(false);
  });

  it("trusted null/unknown → NOT capable (fail-closed)", () => {
    expect(isVehicleFourByFourCapable({ fourByFourVerified: null })).toBe(false);
    // undefined (a legacy row selected without the column) is also not capable.
    expect(isVehicleFourByFourCapable({ fourByFourVerified: undefined as unknown as null })).toBe(false);
  });

  it("NEVER infers capability from vehicleType or make/model (SUV / FOUR_BY_FOUR type / names are ignored)", () => {
    // The function's input type does not even accept vehicleType/make — capability is
    // derived from the trusted flag alone. A "FOUR_BY_FOUR"-typed vehicle with no
    // verification is still NOT capable.
    expect(isVehicleFourByFourCapable({ fourByFourVerified: null } as VehicleFourByFourInputWithNoise)).toBe(false);
  });
});

type VehicleFourByFourInputWithNoise = {
  fourByFourVerified: boolean | null;
  vehicleType?: string;
  make?: string;
};

describe("getVehicleGuestCapacity — guest/customer passengers", () => {
  it("returns the stored guest capacity as-is (no driver adjustment)", () => {
    // A 7-seat vehicle driven by the provider is stored as 6 GUESTS; the helper
    // returns exactly that guest value, it does not subtract a driver seat itself.
    expect(getVehicleGuestCapacity({ passengerCapacity: 6 })).toBe(6);
    expect(getVehicleGuestCapacity({ passengerCapacity: 1 })).toBe(1);
  });

  it("returns null when unknown", () => {
    expect(getVehicleGuestCapacity({ passengerCapacity: null })).toBeNull();
  });
});

// TOUR future-compatibility contract (pinned here; NOT wired to any TOUR flow yet):
// GUIDE_ONLY ignores vehicle capability; GUIDE_WITH_TRANSPORT needs a vehicle but not
// 4x4; GUIDE_WITH_4X4 requires trusted 4x4 capability === true. The authoritative
// check is isVehicleFourByFourCapable — NEVER vehicleType === "FOUR_BY_FOUR".
describe("TOUR package ↔ capability contract (future rules, pinned)", () => {
  it("GUIDE_WITH_4X4 requires trusted 4x4; a non-verified vehicle is ineligible", () => {
    expect(TOUR_PACKAGE_SEMANTICS.GUIDE_WITH_4X4.requiresFourByFour).toBe(true);
    const requires = TOUR_PACKAGE_SEMANTICS.GUIDE_WITH_4X4.requiresFourByFour;
    const verifiedVehicle = { fourByFourVerified: true };
    const claimedButUnverified = { fourByFourVerified: null };
    expect(requires && isVehicleFourByFourCapable(verifiedVehicle)).toBe(true);
    expect(requires && isVehicleFourByFourCapable(claimedButUnverified)).toBe(false);
  });

  it("GUIDE_WITH_TRANSPORT does not require 4x4; GUIDE_ONLY needs no vehicle", () => {
    expect(TOUR_PACKAGE_SEMANTICS.GUIDE_WITH_TRANSPORT.requiresFourByFour).toBe(false);
    expect(TOUR_PACKAGE_SEMANTICS.GUIDE_WITH_TRANSPORT.includesTransport).toBe(true);
    expect(TOUR_PACKAGE_SEMANTICS.GUIDE_ONLY.includesTransport).toBe(false);
  });
});
