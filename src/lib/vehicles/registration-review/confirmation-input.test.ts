import { describe, it, expect } from "vitest";
import { parseConfirmation } from "./confirmation-input";

const FULL = {
  make: "Toyota", model: "Land Cruiser", modelYear: "2019", color: "White",
  bookablePassengerCapacity: "13", licensedPassengerCapacity: "13", registeredSeats: "15",
  plateNumber: "A 12345", plateType: "Private", vin: "JTEBU29J8K5012345", engineNumber: "ENG123",
  usageClassification: "Private", engineCapacity: "4000", emptyWeight: "2500", maximumLoad: "3000",
  axleCount: "2", licenseValidFrom: "01/06/2026", licenseExpiry: "31/05/2027", firstRegistrationDate: "01/06/2019",
  declarationAccepted: "true",
};

describe("parseConfirmation — SUBMIT", () => {
  it("accepts a complete valid claim and normalizes values", () => {
    const r = parseConfirmation(FULL, "SUBMIT");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.values.modelYear).toBe(2019);
      expect(r.values.bookablePassengerCapacity).toBe(13);
      expect(r.values.vin).toBe("JTEBU29J8K5012345");
      expect(r.values.licenseExpiry).toBe("2027-05-31");
      expect(r.declarationAccepted).toBe(true);
    }
  });
  it("requires the declaration", () => {
    const r = parseConfirmation({ ...FULL, declarationAccepted: "false" }, "SUBMIT");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual({ field: "declaration", code: "DECLARATION_REQUIRED" });
  });
  it("flags a missing required field (vin)", () => {
    const r = parseConfirmation({ ...FULL, vin: "" }, "SUBMIT");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual({ field: "vin", code: "REQUIRED" });
  });

  it("color is now required at submit", () => {
    const r = parseConfirmation({ ...FULL, color: "" }, "SUBMIT");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual({ field: "color", code: "REQUIRED" });
  });
  it("enforces the capacity chain", () => {
    const r = parseConfirmation({ ...FULL, bookablePassengerCapacity: "14", licensedPassengerCapacity: "13" }, "SUBMIT");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual({ field: "capacity", code: "BOOKABLE_EXCEEDS_LICENSED" });
  });
  it("rejects a bad VIN charset and an impossible date", () => {
    const r = parseConfirmation({ ...FULL, vin: "IOQ123", licenseExpiry: "2027-02-30" }, "SUBMIT");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual({ field: "vin", code: "INVALID_VIN" });
      expect(r.errors).toContainEqual({ field: "licenseExpiry", code: "INVALID_DATE" });
    }
  });
  it("rejects an out-of-range model year", () => {
    const r = parseConfirmation({ ...FULL, modelYear: "1800" }, "SUBMIT");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "modelYear")).toBe(true);
  });
});

describe("parseConfirmation — DRAFT", () => {
  it("allows a partial claim (no required-field enforcement) but still validates present formats", () => {
    const r = parseConfirmation({ make: "Toyota", modelYear: "2019" }, "DRAFT");
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.values.make).toBe("Toyota"); expect(r.values.model).toBeNull(); }
  });
  it("rejects a malformed present value even in DRAFT", () => {
    const r = parseConfirmation({ modelYear: "not-a-year" }, "DRAFT");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === "modelYear")).toBe(true);
  });
});
