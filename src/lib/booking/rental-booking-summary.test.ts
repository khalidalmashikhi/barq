import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseRentalBookingSummary } from "./rental-booking-summary";

const valid = {
  rentalOfferingId: "off-1",
  vehicleId: "veh-1",
  vehicle: { make: "Toyota", model: "Hiace", modelYear: 2029, color: "white", vehicleType: "VAN", bookablePassengerCapacity: 6 },
  passengerCount: 4,
  dateKeys: ["2030-07-10", "2030-07-12"],
  perDate: [
    { dateKey: "2030-07-10", amount: "40.00", currency: "OMR", source: "BASE" },
    { dateKey: "2030-07-12", amount: "55.00", currency: "OMR", source: "OVERRIDE" },
  ],
  chargeableDays: 2,
  total: "95.00",
  currency: "OMR",
  holdGroupId: "hg-secret",
  quoteFingerprint: "fp-secret",
  pricingUnit: "PER_VEHICLE_DAY",
  timeZone: "Asia/Muscat",
};

describe("parseRentalBookingSummary", () => {
  it("projects a valid snapshot to the customer-safe summary WITHOUT internal ids (holdGroupId/quoteFingerprint)", () => {
    const s = parseRentalBookingSummary(valid);
    expect(s).not.toBeNull();
    expect(s!.passengerCount).toBe(4);
    expect(s!.chargeableDays).toBe(2);
    expect(s!.dateKeys).toEqual(["2030-07-10", "2030-07-12"]);
    expect(s!.total).toBe("95.00");
    expect(s!.vehicle.bookablePassengerCapacity).toBe(6);
    expect(JSON.stringify(s)).not.toMatch(/hg-secret|fp-secret|holdGroupId|quoteFingerprint/);
    expect(JSON.stringify(s)).not.toMatch(/registrationNumber|registeredSeats/i);
  });
  it("fails closed to null for a non-rental / legacy / malformed snapshot", () => {
    expect(parseRentalBookingSummary(null)).toBeNull();
    expect(parseRentalBookingSummary(undefined)).toBeNull();
    expect(parseRentalBookingSummary("x")).toBeNull();
    expect(parseRentalBookingSummary({})).toBeNull();
    expect(parseRentalBookingSummary({ ...valid, passengerCount: 0 })).toBeNull(); // must be positive int
    expect(parseRentalBookingSummary({ ...valid, passengerCount: "4" })).toBeNull();
    expect(parseRentalBookingSummary({ ...valid, vehicle: undefined })).toBeNull();
    expect(parseRentalBookingSummary({ ...valid, dateKeys: "nope" })).toBeNull();
    expect(parseRentalBookingSummary({ ...valid, perDate: [{ dateKey: "x" }] })).toBeNull(); // incomplete per-date
    expect(parseRentalBookingSummary({ ...valid, total: 95 })).toBeNull(); // amounts are strings
  });
  it("tolerates nullable optional vehicle fields", () => {
    const s = parseRentalBookingSummary({ ...valid, vehicle: { ...valid.vehicle, make: null, model: null, modelYear: null, color: null, vehicleType: null } });
    expect(s).not.toBeNull();
    expect(s!.vehicle.make).toBeNull();
    expect(s!.vehicle.bookablePassengerCapacity).toBe(6);
  });
});
