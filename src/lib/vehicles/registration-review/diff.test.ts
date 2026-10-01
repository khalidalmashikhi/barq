import { describe, it, expect } from "vitest";
import { computeFieldDecisions, correctedFieldCount } from "./diff";
import type { ConfirmationValues } from "./confirmation-input";

const base: ConfirmationValues = {
  make: null, model: null, modelYear: null, color: null, bookablePassengerCapacity: null,
  licensedPassengerCapacity: null, registeredSeats: null, plateNumber: null, plateType: null,
  vin: null, engineNumber: null, usageClassification: null, engineCapacity: null, emptyWeight: null,
  maximumLoad: null, axleCount: null, licenseValidFrom: null, licenseExpiry: null, firstRegistrationDate: null,
};

describe("computeFieldDecisions", () => {
  it("matches when confirmed == extracted; corrected (PROVIDER) when it differs", () => {
    const d = computeFieldDecisions({ vin: "JTEBU29J8K5012345", make: "Toyota" }, { ...base, vin: "JTEBU29J8K5012345", make: "Honda" });
    expect(d.vin).toEqual({ matches: true, source: "EXTRACTED" });
    expect(d.make).toEqual({ matches: false, source: "PROVIDER" });
    expect(correctedFieldCount(d)).toBe(1);
  });
  it("manual entry when there was no extraction suggestion", () => {
    const d = computeFieldDecisions({}, { ...base, bookablePassengerCapacity: 13, registeredSeats: 15 });
    expect(d.bookablePassengerCapacity).toEqual({ matches: false, source: "MANUAL" });
    expect(d.registeredSeats).toEqual({ matches: false, source: "MANUAL" });
  });
  it("omits fields the provider left blank", () => {
    const d = computeFieldDecisions({ vin: "X" }, base);
    expect(d.vin).toBeUndefined();
  });
});
