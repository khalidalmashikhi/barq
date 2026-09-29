import { describe, it, expect } from "vitest";
import { licensedCapacityInvariantViolation, isBookableWithinLicensed } from "./capacity-invariant";

// Phase 3C Slice 1 — the pure bookable <= licensed passenger-capacity rule.
describe("licensedCapacityInvariantViolation — bookable <= licensed passenger capacity", () => {
  it("no violation when the LICENSED capacity is unknown (null) — the bookable value stands alone", () => {
    expect(
      licensedCapacityInvariantViolation({ bookablePassengerCapacity: 13, licensedPassengerCapacity: null }),
    ).toBeNull();
    // Even an absurdly high bookable value is permitted while licensed is unknown (fail-open on ABSENT data only).
    expect(isBookableWithinLicensed({ bookablePassengerCapacity: 999, licensedPassengerCapacity: null })).toBe(true);
  });

  it("no violation when the BOOKABLE value is unknown (null)", () => {
    expect(
      licensedCapacityInvariantViolation({ bookablePassengerCapacity: null, licensedPassengerCapacity: 15 }),
    ).toBeNull();
  });

  it("both null → not applicable", () => {
    expect(
      licensedCapacityInvariantViolation({ bookablePassengerCapacity: null, licensedPassengerCapacity: null }),
    ).toBeNull();
  });

  it("permits bookable BELOW the licensed capacity (the spec example: licensed 15, bookable 13)", () => {
    expect(
      licensedCapacityInvariantViolation({ bookablePassengerCapacity: 13, licensedPassengerCapacity: 15 }),
    ).toBeNull();
    expect(isBookableWithinLicensed({ bookablePassengerCapacity: 13, licensedPassengerCapacity: 15 })).toBe(true);
  });

  it("permits bookable EQUAL to the licensed capacity (boundary)", () => {
    expect(
      licensedCapacityInvariantViolation({ bookablePassengerCapacity: 15, licensedPassengerCapacity: 15 }),
    ).toBeNull();
  });

  it("flags bookable ABOVE the licensed capacity (impossible pair) — never silently clamped", () => {
    expect(
      licensedCapacityInvariantViolation({ bookablePassengerCapacity: 16, licensedPassengerCapacity: 15 }),
    ).toBe("BOOKABLE_EXCEEDS_LICENSED");
    expect(isBookableWithinLicensed({ bookablePassengerCapacity: 16, licensedPassengerCapacity: 15 })).toBe(false);
  });
});
