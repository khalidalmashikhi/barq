// Phase 3C — Vehicle Registration Extraction, Slice 2. The PURE, deterministic parser:
// extracted text → an allowlisted, PII-free VehicleRegistrationExtractionResult. No I/O,
// no server-only, no randomness, no floating-point for ids/capacities. Confidence is
// rule-based and explainable (NOT an ML/AI score).

import {
  REGISTRATION_PARSER_VERSION,
  REGISTRATION_DOCUMENT_KIND,
  REGISTRATION_EXTRACTION_SOURCE,
} from "./constants";
import type { RegistrationFieldConfidence } from "./codes";
import {
  REGISTRATION_FIELD_KEYS,
  CRITICAL_REGISTRATION_FIELDS,
  type RegistrationFieldKey,
  type VehicleRegistrationField,
  type VehicleRegistrationFields,
  type VehicleRegistrationExtractionResult,
} from "./types";
import { matchLine } from "./labels";
import { cleanValue, normalizePlate, parseYear, parsePositiveInt, parseMeasure, normalizeVin, parseIsoDate } from "./normalize";

type FieldKind = "text" | "plate" | "year" | "measure" | "int" | "vin" | "date";

const FIELD_KIND: Record<RegistrationFieldKey, FieldKind> = {
  plateNumber: "plate",
  plateType: "text",
  makeDescription: "text",
  model: "text",
  color: "text",
  usageClassification: "text",
  manufactureYear: "year",
  engineCapacity: "measure",
  emptyWeight: "measure",
  maximumLoad: "measure",
  axleCount: "int",
  licensedPassengerCapacity: "int",
  vin: "vin",
  engineNumber: "text",
  licenseValidFrom: "date",
  licenseExpiry: "date",
  firstRegistrationDate: "date",
};

const MIN_MANUFACTURE_YEAR = 1950;

type NormOutcome = { value: string | number | null; confidence: RegistrationFieldConfidence; warnings: string[] };

function normalizeOne(kind: FieldKind, raw: string, maxYear: number): NormOutcome {
  switch (kind) {
    case "text": {
      const v = cleanValue(raw);
      return v.length > 0 ? { value: v, confidence: "HIGH", warnings: [] } : { value: null, confidence: "LOW", warnings: ["UNPARSEABLE"] };
    }
    case "plate": {
      const v = normalizePlate(raw);
      return v ? { value: v, confidence: "HIGH", warnings: [] } : { value: null, confidence: "LOW", warnings: ["UNPARSEABLE"] };
    }
    case "year": {
      const y = parseYear(raw, MIN_MANUFACTURE_YEAR, maxYear);
      return y !== null ? { value: y, confidence: "HIGH", warnings: [] } : { value: null, confidence: "LOW", warnings: ["UNPARSEABLE"] };
    }
    case "int": {
      const n = parsePositiveInt(raw);
      return n !== null ? { value: n, confidence: "HIGH", warnings: [] } : { value: null, confidence: "LOW", warnings: ["UNPARSEABLE"] };
    }
    case "measure": {
      const m = parseMeasure(raw);
      if (!m) return { value: null, confidence: "LOW", warnings: ["UNPARSEABLE"] };
      return m.unit
        ? { value: m.value, confidence: "HIGH", warnings: [] }
        : { value: m.value, confidence: "MEDIUM", warnings: ["UNIT_MISSING"] };
    }
    case "vin": {
      const r = normalizeVin(raw);
      if (!r) return { value: null, confidence: "LOW", warnings: ["UNPARSEABLE"] };
      if (!r.charsetOk) return { value: r.vin, confidence: "LOW", warnings: ["VIN_CHARSET"] };
      if (!r.lengthOk) return { value: r.vin, confidence: "MEDIUM", warnings: ["VIN_LENGTH"] };
      return { value: r.vin, confidence: "HIGH", warnings: [] };
    }
    case "date": {
      const d = parseIsoDate(raw);
      return d !== null ? { value: d, confidence: "HIGH", warnings: [] } : { value: null, confidence: "LOW", warnings: ["UNPARSEABLE"] };
    }
  }
}

function buildField(kind: FieldKind, candidates: string[], maxYear: number): VehicleRegistrationField<string | number> {
  if (candidates.length === 0) {
    return { rawValue: null, normalizedValue: null, confidence: "LOW", warnings: ["MISSING"] };
  }
  const outcomes = candidates.map((raw) => ({ raw, ...normalizeOne(kind, raw, maxYear) }));
  const distinct = new Set(outcomes.filter((o) => o.value !== null).map((o) => JSON.stringify(o.value)));

  if (distinct.size > 1) {
    const first = outcomes[0]!;
    return {
      rawValue: first.raw,
      normalizedValue: first.value,
      confidence: "LOW",
      warnings: Array.from(new Set([...first.warnings, "CONFLICT"])),
    };
  }

  const chosen = outcomes.find((o) => o.value !== null) ?? outcomes[0]!;
  const warnings = [...chosen.warnings];
  if (candidates.length > 1) warnings.push("DUPLICATE_LABEL");
  return { rawValue: chosen.raw, normalizedValue: chosen.value, confidence: chosen.confidence, warnings };
}

/**
 * Parse extracted PDF text into an allowlisted, PII-free result. `now` is injectable for
 * deterministic tests (bounds the manufacture-year ceiling). Owner/insurance PII lines are
 * discarded; only a document-level flag records that PII WAS present (never its value).
 */
export function parseOmanVehicleRegistration(text: string, now: Date = new Date()): VehicleRegistrationExtractionResult {
  const maxYear = now.getUTCFullYear() + 1;
  const lines = text.split(/\r?\n/);

  const candidates: Record<RegistrationFieldKey, string[]> = Object.fromEntries(
    REGISTRATION_FIELD_KEYS.map((k) => [k, [] as string[]]),
  ) as Record<RegistrationFieldKey, string[]>;
  let piiSeen = false;

  for (const line of lines) {
    const m = matchLine(line);
    if (m.kind === "pii") { piiSeen = true; continue; }
    if (m.kind === "field") candidates[m.field].push(m.rawValue);
  }

  const fields = Object.fromEntries(
    REGISTRATION_FIELD_KEYS.map((k) => [k, buildField(FIELD_KIND[k], candidates[k], maxYear)]),
  ) as unknown as VehicleRegistrationFields;

  const warnings: string[] = [];
  if (piiSeen) warnings.push("DISCARDED_PII_LABELS_PRESENT");

  const anySupported = REGISTRATION_FIELD_KEYS.some((k) => fields[k].rawValue !== null);
  let overallStatus: VehicleRegistrationExtractionResult["overallStatus"];
  if (!anySupported) {
    warnings.push("NO_SUPPORTED_FIELDS");
    overallStatus = "FAILED";
  } else {
    const criticalOk = CRITICAL_REGISTRATION_FIELDS.every((k) => {
      const f = fields[k];
      return f.normalizedValue !== null && f.confidence === "HIGH" && !f.warnings.includes("CONFLICT");
    });
    overallStatus = criticalOk ? "EXTRACTED" : "NEEDS_REVIEW";
  }

  return {
    parserVersion: REGISTRATION_PARSER_VERSION,
    documentKind: REGISTRATION_DOCUMENT_KIND,
    source: REGISTRATION_EXTRACTION_SOURCE,
    fields,
    overallStatus,
    warnings,
  };
}
