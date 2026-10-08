import { describe, it, expect } from "vitest";
import { parseOmanVehicleRegistration } from "./parse-registration";
import { serializePersistedFields, serializeWarnings, extractionTypedColumns, persistedFieldsSchema } from "./record";
import { REGISTRATION_FIELD_KEYS } from "./types";

const NOW = new Date("2027-01-01T00:00:00.000Z");
const result = parseOmanVehicleRegistration(
  ["رقم اللوحة: A 12345", "عدد الركاب: 7", "سنة الصنع: 2019", "رقم الهيكل: JTEBU29J8K5012345", "تاريخ الانتهاء: 31/05/2027"].join("\n"),
  NOW,
);

describe("record — persistence mapping", () => {
  it("serializes EXACTLY the allowlisted field keys (no more, no fewer)", () => {
    const fields = serializePersistedFields(result) as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual([...REGISTRATION_FIELD_KEYS].sort());
  });

  it("the strict schema REJECTS any extra (e.g. PII) key", () => {
    const valid = serializePersistedFields(result) as Record<string, unknown>;
    const tampered = { ...valid, ownerName: { rawValue: "x", normalizedValue: "x", confidence: "HIGH", warnings: [] } };
    expect(() => persistedFieldsSchema.parse(tampered)).toThrow();
  });

  it("maps typed searchable identifiers with correct primitive types", () => {
    expect(extractionTypedColumns(result)).toEqual({
      extractedVin: "JTEBU29J8K5012345",
      extractedPlateNumber: "A 12345",
      extractedLicensedPassengerCapacity: 7,
      extractedManufactureYear: 2019,
      licenseExpiryDate: "2027-05-31",
    });
  });

  it("null typed columns when the field is missing", () => {
    const empty = parseOmanVehicleRegistration("عدد الركاب: 7", NOW);
    const cols = extractionTypedColumns(empty);
    expect(cols.extractedVin).toBeNull();
    expect(cols.extractedPlateNumber).toBeNull();
    expect(cols.extractedLicensedPassengerCapacity).toBe(7);
  });

  it("warnings serialize to a plain string[] of codes", () => {
    const w = serializeWarnings(result);
    expect(Array.isArray(w)).toBe(true);
  });
});

describe("record — conflict alternatives (private, bounded)", () => {
  it("accepts a bounded list of validated values on a field; rejects more than four, or anything that is not a plain value", () => {
    const valid = serializePersistedFields(result) as Record<string, Record<string, unknown>>;
    const withAlt = { ...valid, manufactureYear: { ...valid.manufactureYear, normalizedValue: null, confidence: "LOW", warnings: ["CONFLICT"], alternatives: [2019, 2020] } };
    expect(persistedFieldsSchema.safeParse(withAlt).success).toBe(true);
    expect(persistedFieldsSchema.safeParse({ ...withAlt, manufactureYear: { ...withAlt.manufactureYear, alternatives: [1, 2, 3, 4, 5] } }).success).toBe(false);
    expect(persistedFieldsSchema.safeParse({ ...withAlt, manufactureYear: { ...withAlt.manufactureYear, alternatives: [{ owner: "x" }] } }).success).toBe(false);
  });
});
