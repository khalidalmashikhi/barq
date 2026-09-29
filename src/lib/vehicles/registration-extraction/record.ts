// Phase 3C — Vehicle Registration Extraction, Slice 2. Maps a pure parse RESULT to the
// persisted shape: a Zod-VALIDATED private `fields` JSON (allowlisted keys ONLY — a strict
// schema rejects any stray/PII key) plus the few typed searchable identifier columns.
// Pure (no server-only): reusable + unit-testable.

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { REGISTRATION_FIELD_CONFIDENCES } from "./codes";
import { REGISTRATION_FIELD_KEYS, type VehicleRegistrationExtractionResult } from "./types";

const fieldSchema = z
  .object({
    rawValue: z.string().nullable(),
    normalizedValue: z.union([z.string(), z.number()]).nullable(),
    confidence: z.enum(REGISTRATION_FIELD_CONFIDENCES),
    warnings: z.array(z.string()),
  })
  .strict();

// A strict object schema over EXACTLY the allowlisted field keys — no additional (e.g. PII)
// key can ever be present in the persisted metadata.
export const persistedFieldsSchema = z
  .object(Object.fromEntries(REGISTRATION_FIELD_KEYS.map((k) => [k, fieldSchema])))
  .strict();

export type PersistedRegistrationFields = z.infer<typeof persistedFieldsSchema>;

/** Validate + serialize the per-field metadata for the `fields` JSON column. Throws if the
 *  shape is ever wrong (defense-in-depth against a stray/PII key). */
export function serializePersistedFields(result: VehicleRegistrationExtractionResult): Prisma.InputJsonObject {
  const parsed = persistedFieldsSchema.parse(result.fields);
  return parsed as Prisma.InputJsonObject;
}

export type ExtractionTypedColumns = {
  extractedVin: string | null;
  extractedPlateNumber: string | null;
  extractedLicensedPassengerCapacity: number | null;
  extractedManufactureYear: number | null;
  licenseExpiryDate: string | null;
};

function asString(v: string | number | null): string | null {
  return typeof v === "string" ? v : null;
}
function asNumber(v: string | number | null): number | null {
  return typeof v === "number" ? v : null;
}

/** The typed searchable identifiers a later admin comparison indexes/queries. */
export function extractionTypedColumns(result: VehicleRegistrationExtractionResult): ExtractionTypedColumns {
  const f = result.fields;
  return {
    extractedVin: asString(f.vin.normalizedValue),
    extractedPlateNumber: asString(f.plateNumber.normalizedValue),
    extractedLicensedPassengerCapacity: asNumber(f.licensedPassengerCapacity.normalizedValue),
    extractedManufactureYear: asNumber(f.manufactureYear.normalizedValue),
    licenseExpiryDate: asString(f.licenseExpiry.normalizedValue),
  };
}

/** Overall document warnings as a JSON string[] (codes only — never values). */
export function serializeWarnings(result: VehicleRegistrationExtractionResult): Prisma.InputJsonValue {
  return [...result.warnings];
}
