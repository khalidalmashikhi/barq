// Phase 3C Slice 3A — PURE parsing/validation of the provider's confirmation input into typed,
// normalized confirmed values. DRAFT mode validates only the format of present values (all
// optional); SUBMIT mode additionally requires every required field, the capacity chain, and the
// accuracy declaration. No I/O. Reuses the Slice-2 normalizers so provider input and extracted
// text are normalized identically.

import { MIN_VEHICLE_YEAR, MAX_VEHICLE_YEAR, MAX_VEHICLE_PASSENGER_CAPACITY } from "@/lib/vehicles/vehicle-type-codes";
import { parsePositiveInt, parseYear, parseIsoDate, normalizeVin, normalizePlate, cleanValue } from "@/lib/vehicles/registration-extraction/normalize";
import {
  CONFIRMATION_FIELD_KEYS,
  CONFIRMATION_FIELDS,
  REQUIRED_FIELD_KEYS,
  type ConfirmationFieldKey,
  type ConfirmationFieldKind,
} from "./field-model";
import { capacityClaimViolations } from "./capacity-claim";

export type ConfirmationValues = Record<ConfirmationFieldKey, string | number | null>;

export type ConfirmationFieldError = { field: ConfirmationFieldKey | "declaration" | "capacity"; code: string };

export type ConfirmationParseResult =
  | { ok: true; values: ConfirmationValues; declarationAccepted: boolean }
  | { ok: false; errors: ConfirmationFieldError[] };

const HTML_TAG = /<\/?[a-z][\s\S]*?>/i;
const TEXT_MAX = 120;
const INT_BOUNDS: Partial<Record<ConfirmationFieldKey, { min: number; max: number }>> = {
  modelYear: { min: MIN_VEHICLE_YEAR, max: MAX_VEHICLE_YEAR },
  bookablePassengerCapacity: { min: 1, max: MAX_VEHICLE_PASSENGER_CAPACITY },
  licensedPassengerCapacity: { min: 1, max: MAX_VEHICLE_PASSENGER_CAPACITY },
  registeredSeats: { min: 1, max: MAX_VEHICLE_PASSENGER_CAPACITY },
  engineCapacity: { min: 1, max: 100_000 },
  emptyWeight: { min: 1, max: 1_000_000 },
  maximumLoad: { min: 1, max: 1_000_000 },
  axleCount: { min: 1, max: 20 },
};

function rawString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = cleanValue(String(v));
  return s.length === 0 ? null : s;
}

// Normalizes one field's raw value → { value } or { error }. A null (absent) value is OK here
// (required-ness is enforced separately for SUBMIT), so absent → { value: null }.
function normalizeField(key: ConfirmationFieldKey, kind: ConfirmationFieldKind, raw: unknown): { value: string | number | null } | { error: string } {
  const s = rawString(raw);
  if (s === null) return { value: null };
  switch (kind) {
    case "text": {
      if (s.length > TEXT_MAX) return { error: "TOO_LONG" };
      if (HTML_TAG.test(s)) return { error: "INVALID" };
      return { value: s };
    }
    case "int": {
      const n = parsePositiveInt(s);
      if (n === null) return { error: "INVALID" };
      if (key === "modelYear") {
        const y = parseYear(s, MIN_VEHICLE_YEAR, MAX_VEHICLE_YEAR);
        return y === null ? { error: "OUT_OF_RANGE" } : { value: y };
      }
      const b = INT_BOUNDS[key];
      if (b && (n < b.min || n > b.max)) return { error: "OUT_OF_RANGE" };
      return { value: n };
    }
    case "date": {
      const iso = parseIsoDate(s);
      return iso === null ? { error: "INVALID_DATE" } : { value: iso };
    }
    case "vin": {
      const r = normalizeVin(s);
      if (!r || !r.charsetOk) return { error: "INVALID_VIN" };
      if (r.vin.length > 17) return { error: "INVALID_VIN" };
      return { value: r.vin }; // non-17 length allowed (legacy); charset enforced
    }
    case "plate": {
      const p = normalizePlate(s);
      return p === null ? { error: "INVALID" } : { value: p.slice(0, 32) };
    }
  }
}

export function parseConfirmation(raw: Record<string, unknown>, mode: "DRAFT" | "SUBMIT"): ConfirmationParseResult {
  const values = {} as ConfirmationValues;
  const errors: ConfirmationFieldError[] = [];

  for (const key of CONFIRMATION_FIELD_KEYS) {
    const spec = CONFIRMATION_FIELDS[key];
    const res = normalizeField(key, spec.kind, raw[key]);
    if ("error" in res) {
      errors.push({ field: key, code: res.error });
      values[key] = null;
    } else {
      values[key] = res.value;
    }
  }

  const declarationAccepted = raw.declarationAccepted === true || raw.declarationAccepted === "true" || raw.declarationAccepted === "on";

  if (mode === "SUBMIT") {
    for (const key of REQUIRED_FIELD_KEYS) {
      if (values[key] === null && !errors.some((e) => e.field === key)) errors.push({ field: key, code: "REQUIRED" });
    }
    for (const v of capacityClaimViolations({
      bookablePassengerCapacity: typeof values.bookablePassengerCapacity === "number" ? values.bookablePassengerCapacity : null,
      licensedPassengerCapacity: typeof values.licensedPassengerCapacity === "number" ? values.licensedPassengerCapacity : null,
      registeredSeats: typeof values.registeredSeats === "number" ? values.registeredSeats : null,
    })) {
      errors.push({ field: "capacity", code: v });
    }
    if (!declarationAccepted) errors.push({ field: "declaration", code: "DECLARATION_REQUIRED" });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, values, declarationAccepted };
}
