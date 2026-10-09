// Phase 3C — Vehicle Registration Extraction, Slice 2. The pure parsing contract.
// Deterministic, allowlisted, and free of any owner/insurance PII by construction.

import type { RegistrationDocumentKind, RegistrationExtractionSource } from "./constants";
import type { RegistrationFieldConfidence, RegistrationExtractionStatus } from "./codes";

/** A single extracted field. `rawValue` is preserved ONLY for allowlisted operational
 *  fields (never for discarded PII). `confidence` is rule-based + explainable. */
export type VehicleRegistrationField<T> = {
  /** The original captured substring for this field (allowlisted fields only), or null when missing. */
  rawValue: string | null;
  /** The strictly-normalized value, or null when missing/unparseable. Never floating-point for ids/capacities. */
  normalizedValue: T | null;
  confidence: RegistrationFieldConfidence;
  /** Deterministic, machine-readable warning codes (e.g. "MISSING", "CONFLICT", "VIN_LENGTH", "UNIT_MISSING",
   *  "HEURISTIC_SPLIT" = derived from the document's compound description, always LOW). */
  warnings: string[];
  /** CONFLICT only: every distinct validated value the document(s) showed for this field, in
   *  detection order (front/page 1 first). The field is then UNRESOLVED (normalizedValue null) —
   *  nothing is chosen silently; the provider picks one or types the confirmed value. Private. */
  alternatives?: T[];
};

/** The ALLOWLISTED operational fields. Owner/nationality/address/civil-number/insurer/
 *  policy/mortgage/barcode/officer are DELIBERATELY absent — they are discarded, never typed here.
 *
 *  OMAN TERMINOLOGY (field-mapping contract, 2026-10-09):
 *  • `makeDescription` — the manufacturer / brand ONLY, from an explicit make label, or derived
 *    (LOW, "HEURISTIC_SPLIT") from the compound description when the manufacturer is recognizable.
 *  • `model` — the commercial model NAME only. NEVER a year: a year under a model label is routed
 *    to `manufactureYear`.
 *  • `manufactureYear` — the model year / year of manufacture. On the Omani card the label
 *    "الموديل" usually holds this year.
 *  • `vehicleDescription` — the full description string printed under "نوع المركبة" (usually
 *    brand + body style + model). Kept PRIVATE, whole, for review/audit; never copied to make.
 *  • `licensedPassengerCapacity` — the passenger count printed under "عدد الركاب".
 *  • `registeredSeats` — a total seat count ONLY when a separate seats label is printed. Never
 *    computed from the passenger count. */
export type VehicleRegistrationFields = {
  plateNumber: VehicleRegistrationField<string>;
  plateType: VehicleRegistrationField<string>;
  makeDescription: VehicleRegistrationField<string>;
  model: VehicleRegistrationField<string>;
  vehicleDescription: VehicleRegistrationField<string>;
  color: VehicleRegistrationField<string>;
  usageClassification: VehicleRegistrationField<string>;
  manufactureYear: VehicleRegistrationField<number>;
  engineCapacity: VehicleRegistrationField<number>;
  emptyWeight: VehicleRegistrationField<number>;
  maximumLoad: VehicleRegistrationField<number>;
  axleCount: VehicleRegistrationField<number>;
  /** From the Arabic label "عدد الركاب" — the official licensed passenger capacity. */
  licensedPassengerCapacity: VehicleRegistrationField<number>;
  /** Only from an explicit seats label ("عدد المقاعد" / "seats"). Never derived. */
  registeredSeats: VehicleRegistrationField<number>;
  /** Chassis / VIN. */
  vin: VehicleRegistrationField<string>;
  engineNumber: VehicleRegistrationField<string>;
  licenseValidFrom: VehicleRegistrationField<string>; // ISO YYYY-MM-DD
  licenseExpiry: VehicleRegistrationField<string>; // ISO YYYY-MM-DD
  firstRegistrationDate: VehicleRegistrationField<string>; // ISO YYYY-MM-DD
};

/** The ordered list of allowlisted field keys (single source of truth for iteration). */
export const REGISTRATION_FIELD_KEYS = [
  "plateNumber",
  "plateType",
  "makeDescription",
  "model",
  "vehicleDescription",
  "color",
  "usageClassification",
  "manufactureYear",
  "engineCapacity",
  "emptyWeight",
  "maximumLoad",
  "axleCount",
  "licensedPassengerCapacity",
  "registeredSeats",
  "vin",
  "engineNumber",
  "licenseValidFrom",
  "licenseExpiry",
  "firstRegistrationDate",
] as const satisfies readonly (keyof VehicleRegistrationFields)[];

export type RegistrationFieldKey = (typeof REGISTRATION_FIELD_KEYS)[number];

/** Keys added by parser 1.1.0 — absent from records written by 1.0.0 (read as missing). */
export const REGISTRATION_FIELD_KEYS_ADDED_1_1 = ["vehicleDescription", "registeredSeats"] as const satisfies readonly RegistrationFieldKey[];

/** The "critical" identifiers whose absence/low-confidence forces NEEDS_REVIEW and which a
 *  later admin flow treats as critical-mismatch candidates. */
export const CRITICAL_REGISTRATION_FIELDS = [
  "plateNumber",
  "makeDescription",
  "model",
  "manufactureYear",
  "licensedPassengerCapacity",
  "vin",
  "licenseExpiry",
] as const satisfies readonly RegistrationFieldKey[];

export type VehicleRegistrationExtractionResult = {
  parserVersion: string;
  documentKind: RegistrationDocumentKind;
  source: RegistrationExtractionSource;
  fields: VehicleRegistrationFields;
  overallStatus: RegistrationExtractionStatus;
  /** Document-level warning codes (e.g. "NO_SUPPORTED_FIELDS", "DISCARDED_PII_LABELS_PRESENT",
   *  "MODEL_LABEL_HELD_YEAR", "DESCRIPTION_NOT_SPLIT"). */
  warnings: string[];
};

/** One piece of text detected for a field, before normalization. `unclear` is set by an OCR engine
 *  when it could not read the value with certainty (it then counts as LOW confidence). */
export type RegistrationCandidate = { text: string; unclear?: boolean };

/** Detected text per allowlisted field — the ONLY shape an OCR engine may contribute. There is no
 *  key for owner / civil number / address / insurance, so such data cannot be carried through. */
export type RegistrationCandidates = Partial<Record<RegistrationFieldKey, RegistrationCandidate[]>>;
