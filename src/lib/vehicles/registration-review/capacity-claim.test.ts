import { describe, it, expect } from "vitest";
import { capacityClaimViolations, isCapacityClaimValid } from "./capacity-claim";

describe("capacity-claim — bookable <= licensed <= registered", () => {
  it("valid chain (13 <= 13 <= 15)", () => {
    expect(capacityClaimViolations({ bookablePassengerCapacity: 13, licensedPassengerCapacity: 13, registeredSeats: 15 })).toEqual([]);
  });
  it("bookable > licensed", () => {
    expect(capacityClaimViolations({ bookablePassengerCapacity: 14, licensedPassengerCapacity: 13, registeredSeats: 15 })).toContain("BOOKABLE_EXCEEDS_LICENSED");
  });
  it("licensed > registered", () => {
    expect(capacityClaimViolations({ bookablePassengerCapacity: 10, licensedPassengerCapacity: 16, registeredSeats: 15 })).toContain("LICENSED_EXCEEDS_REGISTERED");
  });
  it("bookable > registered (direct)", () => {
    expect(capacityClaimViolations({ bookablePassengerCapacity: 16, licensedPassengerCapacity: null, registeredSeats: 15 })).toContain("BOOKABLE_EXCEEDS_REGISTERED");
  });
  it("absent values never block", () => {
    expect(isCapacityClaimValid({ bookablePassengerCapacity: 13, licensedPassengerCapacity: null, registeredSeats: null })).toBe(true);
    expect(isCapacityClaimValid({ bookablePassengerCapacity: null, licensedPassengerCapacity: null, registeredSeats: null })).toBe(true);
  });
});
