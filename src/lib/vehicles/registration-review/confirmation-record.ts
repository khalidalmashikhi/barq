// Phase 3C Slice 3A — PURE persistence mapping for a confirmation claim: typed column data from
// validated values, a Zod-validated bounded `fieldDecisions` JSON (metadata only), and a reader
// that maps stored columns back to ConfirmationValues. No raw text, no PII — only allowlisted keys.

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { CONFIRMATION_FIELD_KEYS, type ConfirmationFieldKey } from "./field-model";
import type { ConfirmationValues } from "./confirmation-input";
import type { FieldDecisions } from "./diff";

const str = (x: string | number | null | undefined): string | null => (typeof x === "string" ? x : null);
const num = (x: string | number | null | undefined): number | null => (typeof x === "number" ? x : null);

export type ConfirmationColumnData = {
  make: string | null; model: string | null; modelYear: number | null; color: string | null;
  bookablePassengerCapacity: number | null; licensedPassengerCapacity: number | null; registeredSeats: number | null;
  plateNumber: string | null; plateType: string | null; vin: string | null; engineNumber: string | null;
  usageClassification: string | null; engineCapacity: number | null; emptyWeight: number | null; maximumLoad: number | null;
  axleCount: number | null; licenseValidFrom: string | null; licenseExpiry: string | null; firstRegistrationDate: string | null;
};

export function confirmationColumns(v: ConfirmationValues): ConfirmationColumnData {
  return {
    make: str(v.make), model: str(v.model), modelYear: num(v.modelYear), color: str(v.color),
    bookablePassengerCapacity: num(v.bookablePassengerCapacity), licensedPassengerCapacity: num(v.licensedPassengerCapacity), registeredSeats: num(v.registeredSeats),
    plateNumber: str(v.plateNumber), plateType: str(v.plateType), vin: str(v.vin), engineNumber: str(v.engineNumber),
    usageClassification: str(v.usageClassification), engineCapacity: num(v.engineCapacity), emptyWeight: num(v.emptyWeight), maximumLoad: num(v.maximumLoad),
    axleCount: num(v.axleCount), licenseValidFrom: str(v.licenseValidFrom), licenseExpiry: str(v.licenseExpiry), firstRegistrationDate: str(v.firstRegistrationDate),
  };
}

/** Read stored columns back into the ConfirmationValues shape (for prefill/diff/display). */
export function columnsToValues(row: Partial<ConfirmationColumnData>): ConfirmationValues {
  const out = {} as ConfirmationValues;
  for (const key of CONFIRMATION_FIELD_KEYS) out[key] = (row as Record<string, string | number | null | undefined>)[key] ?? null;
  return out;
}

// Strict, bounded schema for the persisted fieldDecisions JSON — only allowlisted keys, each a
// small {matches, source} record. Rejects any stray key (defense-in-depth against a PII leak).
const decisionSchema = z.object({ matches: z.boolean(), source: z.enum(["EXTRACTED", "PROVIDER", "MANUAL"]) }).strict();
export const fieldDecisionsSchema = z
  .object(Object.fromEntries(CONFIRMATION_FIELD_KEYS.map((k) => [k, decisionSchema.optional()])))
  .strict();

export function serializeFieldDecisions(decisions: FieldDecisions): Prisma.InputJsonValue {
  return fieldDecisionsSchema.parse(decisions) as Prisma.InputJsonValue;
}
