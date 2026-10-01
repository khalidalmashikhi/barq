// Phase 3C — Vehicle Registration Workflow, Slice 3A. The single registry mapping each
// provider-CONFIRMED field to its group (customer-relevant vs private-operational), input kind,
// the extraction field that suggests it (or null when the provider must enter it manually),
// whether it is a sensitive identifier (masked by default in the UI), and whether it is required
// to SUBMIT. Pure, no I/O. The authoritative source of truth for the review UI + validation.

import type { RegistrationFieldKey } from "@/lib/vehicles/registration-extraction/types";

export type ConfirmationFieldKey =
  | "make"
  | "model"
  | "modelYear"
  | "color"
  | "bookablePassengerCapacity"
  | "licensedPassengerCapacity"
  | "registeredSeats"
  | "plateNumber"
  | "plateType"
  | "vin"
  | "engineNumber"
  | "usageClassification"
  | "engineCapacity"
  | "emptyWeight"
  | "maximumLoad"
  | "axleCount"
  | "licenseValidFrom"
  | "licenseExpiry"
  | "firstRegistrationDate";

export type ConfirmationFieldKind = "text" | "int" | "date" | "vin" | "plate";
export type ConfirmationFieldGroup = "CUSTOMER" | "PRIVATE";

export type ConfirmationFieldSpec = {
  group: ConfirmationFieldGroup;
  kind: ConfirmationFieldKind;
  /** The extraction field that suggests this value, or null when it is provider-entered only. */
  extractionKey: RegistrationFieldKey | null;
  /** Sensitive identifier — masked by default in the UI with an explicit reveal control. */
  sensitive: boolean;
  /** Required for SUBMIT (the fields a later admin verification needs). */
  required: boolean;
};

export const CONFIRMATION_FIELDS: Record<ConfirmationFieldKey, ConfirmationFieldSpec> = {
  // Customer-relevant (may become customer-visible only after a LATER admin-verification slice).
  make: { group: "CUSTOMER", kind: "text", extractionKey: "makeDescription", sensitive: false, required: true },
  model: { group: "CUSTOMER", kind: "text", extractionKey: "model", sensitive: false, required: true },
  modelYear: { group: "CUSTOMER", kind: "int", extractionKey: "manufactureYear", sensitive: false, required: true },
  color: { group: "CUSTOMER", kind: "text", extractionKey: "color", sensitive: false, required: false },
  // Provider CHOOSES the operational bookable capacity — never auto-copied from licensed/registered.
  bookablePassengerCapacity: { group: "CUSTOMER", kind: "int", extractionKey: null, sensitive: false, required: true },
  // Private operational / verification evidence (provider file only).
  licensedPassengerCapacity: { group: "PRIVATE", kind: "int", extractionKey: "licensedPassengerCapacity", sensitive: false, required: true },
  registeredSeats: { group: "PRIVATE", kind: "int", extractionKey: null, sensitive: false, required: true },
  plateNumber: { group: "PRIVATE", kind: "plate", extractionKey: "plateNumber", sensitive: true, required: true },
  plateType: { group: "PRIVATE", kind: "text", extractionKey: "plateType", sensitive: false, required: false },
  vin: { group: "PRIVATE", kind: "vin", extractionKey: "vin", sensitive: true, required: true },
  engineNumber: { group: "PRIVATE", kind: "text", extractionKey: "engineNumber", sensitive: true, required: false },
  usageClassification: { group: "PRIVATE", kind: "text", extractionKey: "usageClassification", sensitive: false, required: false },
  engineCapacity: { group: "PRIVATE", kind: "int", extractionKey: "engineCapacity", sensitive: false, required: false },
  emptyWeight: { group: "PRIVATE", kind: "int", extractionKey: "emptyWeight", sensitive: false, required: false },
  maximumLoad: { group: "PRIVATE", kind: "int", extractionKey: "maximumLoad", sensitive: false, required: false },
  axleCount: { group: "PRIVATE", kind: "int", extractionKey: "axleCount", sensitive: false, required: false },
  licenseValidFrom: { group: "PRIVATE", kind: "date", extractionKey: "licenseValidFrom", sensitive: false, required: false },
  licenseExpiry: { group: "PRIVATE", kind: "date", extractionKey: "licenseExpiry", sensitive: false, required: true },
  firstRegistrationDate: { group: "PRIVATE", kind: "date", extractionKey: "firstRegistrationDate", sensitive: false, required: false },
};

export const CONFIRMATION_FIELD_KEYS = Object.keys(CONFIRMATION_FIELDS) as ConfirmationFieldKey[];

export const CUSTOMER_FIELD_KEYS = CONFIRMATION_FIELD_KEYS.filter((k) => CONFIRMATION_FIELDS[k].group === "CUSTOMER");
export const PRIVATE_FIELD_KEYS = CONFIRMATION_FIELD_KEYS.filter((k) => CONFIRMATION_FIELDS[k].group === "PRIVATE");
export const SENSITIVE_FIELD_KEYS = CONFIRMATION_FIELD_KEYS.filter((k) => CONFIRMATION_FIELDS[k].sensitive);
export const REQUIRED_FIELD_KEYS = CONFIRMATION_FIELD_KEYS.filter((k) => CONFIRMATION_FIELDS[k].required);

export function isConfirmationFieldKey(v: unknown): v is ConfirmationFieldKey {
  return typeof v === "string" && v in CONFIRMATION_FIELDS;
}

/** provider.json label key for a field, e.g. "make" → "vehicleRegFieldMake". */
export function regFieldLabelKey(key: ConfirmationFieldKey): string {
  return "vehicleRegField" + key.charAt(0).toUpperCase() + key.slice(1);
}

/** Mask a sensitive value for default display: keep the last 4 visible, mask the rest. */
export function maskSensitiveValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return trimmed;
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  return "•".repeat(trimmed.length - 4) + trimmed.slice(-4);
}
