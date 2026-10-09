import { describe, it, expect } from "vitest";
import { CONFIRMATION_FIELDS, SENSITIVE_FIELD_KEYS, REQUIRED_FIELD_KEYS, CUSTOMER_FIELD_KEYS, PRIVATE_FIELD_KEYS, maskSensitiveValue } from "./field-model";

describe("field-model", () => {
  it("marks VIN, plate, and engine number as sensitive (masked by default)", () => {
    expect(SENSITIVE_FIELD_KEYS.sort()).toEqual(["engineNumber", "plateNumber", "vin"].sort());
  });
  it("bookablePassengerCapacity is provider-entered (no extraction suggestion); registeredSeats comes ONLY from the explicit seats field and is optional", () => {
    expect(CONFIRMATION_FIELDS.bookablePassengerCapacity.extractionKey).toBeNull();
    expect(CONFIRMATION_FIELDS.registeredSeats.extractionKey).toBe("registeredSeats");
    expect(CONFIRMATION_FIELDS.registeredSeats.required).toBe(false);
    expect(CONFIRMATION_FIELDS.modelYear.extractionKey).toBe("manufactureYear");
    expect(CONFIRMATION_FIELDS.model.extractionKey).toBe("model");
    expect(CONFIRMATION_FIELDS.vin.extractionKey).toBe("vin");
    expect(CONFIRMATION_FIELDS.make.extractionKey).toBe("makeDescription");
  });
  it("customer-relevant group is the small useful set; capacities/ids are private", () => {
    expect(CUSTOMER_FIELD_KEYS).toContain("make");
    expect(CUSTOMER_FIELD_KEYS).toContain("bookablePassengerCapacity");
    expect(CUSTOMER_FIELD_KEYS).not.toContain("vin");
    expect(PRIVATE_FIELD_KEYS).toContain("vin");
    expect(PRIVATE_FIELD_KEYS).toContain("licensedPassengerCapacity");
  });
  it("required-for-submit includes the critical verification fields", () => {
    for (const k of ["make", "model", "modelYear", "color", "bookablePassengerCapacity", "licensedPassengerCapacity", "plateNumber", "vin", "licenseExpiry"]) {
      expect(REQUIRED_FIELD_KEYS).toContain(k);
    }
    expect(REQUIRED_FIELD_KEYS).not.toContain("registeredSeats"); // most cards print no seat total — it stays unresolved, never invented
  });
  it("maskSensitiveValue keeps only the last 4 characters", () => {
    expect(maskSensitiveValue("JTEBU29J8K5012345")).toBe("•••••••••••••2345");
    expect(maskSensitiveValue("AB")).toBe("••");
    expect(maskSensitiveValue(null)).toBeNull();
  });
});
