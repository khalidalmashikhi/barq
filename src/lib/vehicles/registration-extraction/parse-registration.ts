// Phase 3C — Vehicle Registration Extraction, Slice 2. The PURE, deterministic parser:
// extracted text → an allowlisted, PII-free VehicleRegistrationExtractionResult. No I/O,
// no server-only, no randomness, no floating-point for ids/capacities. Confidence is
// rule-based and explainable (NOT an ML/AI score).

import {
  REGISTRATION_PARSER_VERSION,
  REGISTRATION_DOCUMENT_KIND,
  REGISTRATION_EXTRACTION_SOURCE,
  REGISTRATION_OCR_SOURCE,
  type RegistrationExtractionSource,
} from "./constants";
import type { RegistrationFieldConfidence } from "./codes";
import {
  REGISTRATION_FIELD_KEYS,
  CRITICAL_REGISTRATION_FIELDS,
  type RegistrationFieldKey,
  type VehicleRegistrationField,
  type VehicleRegistrationFields,
  type VehicleRegistrationExtractionResult,
  type RegistrationCandidate,
  type RegistrationCandidates,
} from "./types";
import { matchLine } from "./labels";
import { cleanValue, normalizePlate, parseYear, parsePositiveInt, parseMeasure, normalizeVin, parseIsoDate } from "./normalize";
import { splitVehicleDescription, isYearLike } from "./vehicle-description";
import { canonicalManufacturer } from "./manufacturer-registry";
import { foldForMatching } from "./normalize";

// "name" = a make / model NAME: text that is never allowed to be a bare year (the Omani label
// "الموديل" usually holds the model YEAR; the shared router below moves such values to
// manufactureYear before the field is built, and anything year-like that still arrives here is
// refused rather than stored as a name).
type FieldKind = "text" | "name" | "plate" | "year" | "measure" | "int" | "vin" | "date";

const FIELD_KIND: Record<RegistrationFieldKey, FieldKind> = {
  plateNumber: "plate",
  plateType: "text",
  makeDescription: "name",
  model: "name",
  vehicleDescription: "text",
  color: "text",
  usageClassification: "text",
  manufactureYear: "year",
  engineCapacity: "measure",
  emptyWeight: "measure",
  maximumLoad: "measure",
  axleCount: "int",
  licensedPassengerCapacity: "int",
  registeredSeats: "int",
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
    case "name": {
      const v = cleanValue(raw);
      if (v.length === 0) return { value: null, confidence: "LOW", warnings: ["UNPARSEABLE"] };
      // A year is never a manufacturer or a commercial model name — unresolved, never stored.
      if (isYearLike(v)) return { value: null, confidence: "LOW", warnings: ["YEAR_NOT_NAME"] };
      return { value: v, confidence: "HIGH", warnings: [] };
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

// OCR is a READING AID, never evidence: an OCR-derived value can be at most MEDIUM (so every one
// of them is shown as "check this"), and LOW when the engine itself flagged it as hard to read.
function capForOcr(confidence: RegistrationFieldConfidence, unclear: boolean): { confidence: RegistrationFieldConfidence; warnings: string[] } {
  if (unclear) return { confidence: "LOW", warnings: ["OCR_UNCLEAR"] };
  return { confidence: confidence === "HIGH" ? "MEDIUM" : confidence, warnings: [] };
}

function buildField(kind: FieldKind, candidates: RegistrationCandidate[], maxYear: number, source: RegistrationExtractionSource): VehicleRegistrationField<string | number> {
  if (candidates.length === 0) {
    return { rawValue: null, normalizedValue: null, confidence: "LOW", warnings: ["MISSING"] };
  }
  const outcomes = candidates.map((c) => ({ raw: c.text, unclear: c.unclear === true, ...normalizeOne(kind, c.text, maxYear) }));
  const distinct = new Set(outcomes.filter((o) => o.value !== null).map((o) => JSON.stringify(o.value)));

  if (distinct.size > 1) {
    // Two (or more) different valid values for one field — e.g. printed differently on the front
    // and the back, or on page 1 and page 2. NOTHING is chosen silently: the field is unresolved,
    // every distinct value is kept (bounded) for the provider to choose from or overrule.
    const first = outcomes[0]!;
    const alternatives: (string | number)[] = [];
    for (const o of outcomes) {
      if (o.value !== null && !alternatives.some((a) => JSON.stringify(a) === JSON.stringify(o.value))) alternatives.push(o.value);
      if (alternatives.length >= 4) break;
    }
    return { rawValue: first.raw, normalizedValue: null, confidence: "LOW", warnings: ["CONFLICT"], alternatives };
  }

  const chosen = outcomes.find((o) => o.value !== null) ?? outcomes[0]!;
  const warnings = [...chosen.warnings];
  if (candidates.length > 1) warnings.push("DUPLICATE_LABEL");
  if (source !== REGISTRATION_OCR_SOURCE) return { rawValue: chosen.raw, normalizedValue: chosen.value, confidence: chosen.confidence, warnings };
  const capped = capForOcr(chosen.confidence, chosen.unclear);
  return { rawValue: chosen.raw, normalizedValue: chosen.value, confidence: capped.confidence, warnings: [...warnings, ...capped.warnings] };
}

/**
 * OMAN TERMINOLOGY ROUTING — shared by BOTH tiers (native PDF text and OCR), applied to the raw
 * candidates BEFORE any field is built, so neither source can bypass it:
 *   • a 4-digit year reported under the model label ("الموديل" / "model") is the MODEL YEAR →
 *     it becomes a `manufactureYear` candidate (de-duplicated) and leaves `model`;
 *   • a year reported as the make is dropped (a make is never a year).
 * Returns the routed candidates and the document-level codes explaining what moved.
 */
export function routeRegistrationCandidates(candidates: RegistrationCandidates): { candidates: RegistrationCandidates; warnings: string[] } {
  const out: RegistrationCandidates = { ...candidates };
  const warnings: string[] = [];
  const years = [...(out.manufactureYear ?? [])];
  const modelNames: RegistrationCandidate[] = [];
  for (const c of out.model ?? []) {
    if (isYearLike(c.text)) {
      if (!years.some((y) => cleanValue(y.text) === cleanValue(c.text))) years.push(c);
      if (!warnings.includes("MODEL_LABEL_HELD_YEAR")) warnings.push("MODEL_LABEL_HELD_YEAR");
    } else modelNames.push(c);
  }
  if ((out.model ?? []).length !== modelNames.length) out.model = modelNames;
  if (years.length !== (out.manufactureYear ?? []).length) out.manufactureYear = years;
  const makes = (out.makeDescription ?? []).filter((c) => !isYearLike(c.text));
  if (makes.length !== (out.makeDescription ?? []).length) {
    out.makeDescription = makes;
    warnings.push("MAKE_LABEL_HELD_YEAR");
  }
  for (const k of ["model", "manufactureYear", "makeDescription"] as const) if (out[k] && out[k]!.length === 0) delete out[k];
  return { candidates: out, warnings };
}

const unresolved = (f: VehicleRegistrationField<string | number>) => f.normalizedValue === null && !f.warnings.includes("CONFLICT");

/**
 * Turn detected text per field into the allowlisted, validated result. The SAME normalizers and
 * rules apply whatever produced the text (native PDF text or OCR): a value that does not validate
 * is unresolved (null), two different values for one field are a CONFLICT, and nothing is inferred
 * for a field with no candidate. `now` bounds the manufacture-year ceiling (injectable for tests).
 *
 * After the fields are built, the COMPOUND DESCRIPTION rule runs (shared by both tiers): when the
 * document printed a description ("نوع المركبة") and the manufacturer / model were not printed as
 * their own values, a conservative, dictionary-based split may SUGGEST them — always LOW
 * confidence with "HEURISTIC_SPLIT" (so they are flagged for review and can never be EXTRACTED
 * silently). When the manufacturer is not recognized, nothing is split: the fields stay unresolved
 * and the whole description is kept privately for the provider to read.
 */
export function buildRegistrationExtraction(
  rawCandidates: RegistrationCandidates,
  options: { source: RegistrationExtractionSource; now?: Date; piiSeen?: boolean },
): VehicleRegistrationExtractionResult {
  const maxYear = (options.now ?? new Date()).getUTCFullYear() + 1;
  const routed = routeRegistrationCandidates(rawCandidates);
  const candidates = routed.candidates;

  const fields = Object.fromEntries(
    REGISTRATION_FIELD_KEYS.map((k) => [k, buildField(FIELD_KIND[k], candidates[k] ?? [], maxYear, options.source)]),
  ) as unknown as VehicleRegistrationFields;

  const warnings: string[] = [...routed.warnings];
  if (options.piiSeen) warnings.push("DISCARDED_PII_LABELS_PRESENT");

  // An EXPLICIT make printed as an alias of a governed manufacturer is emitted in its canonical form
  // (confidence unchanged); a value the registry does not know is kept exactly as printed.
  if (typeof fields.makeDescription.normalizedValue === "string") {
    const canon = canonicalManufacturer(fields.makeDescription.normalizedValue);
    if (canon) fields.makeDescription = { ...fields.makeDescription, normalizedValue: canon };
  }

  // COMPOUND DESCRIPTION — the same shared, deterministic decomposition for both tiers.
  // PRECEDENCE: (1) an explicit value under a trustworthy label wins; (2) a derived value fills ONLY
  // an unresolved field, always LOW + HEURISTIC_SPLIT; (3) a derived value never overwrites an
  // explicit one; (4) when explicit and derived DISAGREE the field becomes a CONFLICT the provider
  // resolves (both kept, nothing chosen); (5) the year keeps its own semantics; (6) the body style
  // is only a type HINT — the provider confirms the type.
  const description = fields.vehicleDescription.normalizedValue;
  if (typeof description === "string") {
    const outcome = splitVehicleDescription(description);
    if (!outcome.ok) {
      warnings.push("DESCRIPTION_NOT_SPLIT", `DESCRIPTION_${outcome.reason}`);
    } else {
      const { make, model, modelReason } = outcome.split;
      const sameText = (a: string | number, b: string) => foldForMatching(String(a)) === foldForMatching(b);
      // make
      if (unresolved(fields.makeDescription)) {
        fields.makeDescription = { rawValue: description, normalizedValue: make, confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] };
      } else if (fields.makeDescription.normalizedValue !== null && !fields.makeDescription.warnings.includes("CONFLICT") && !sameText(fields.makeDescription.normalizedValue, make)) {
        const explicit = fields.makeDescription.normalizedValue;
        fields.makeDescription = { rawValue: fields.makeDescription.rawValue, normalizedValue: null, confidence: "LOW", warnings: ["CONFLICT", "EXPLICIT_VS_DERIVED"], alternatives: [explicit, make] };
      }
      // model
      if (model !== null) {
        if (unresolved(fields.model)) {
          fields.model = { rawValue: description, normalizedValue: model, confidence: "LOW", warnings: ["HEURISTIC_SPLIT"] };
        } else if (fields.model.normalizedValue !== null && !fields.model.warnings.includes("CONFLICT") && !sameText(fields.model.normalizedValue, model)) {
          const explicit = fields.model.normalizedValue;
          fields.model = { rawValue: fields.model.rawValue, normalizedValue: null, confidence: "LOW", warnings: ["CONFLICT", "EXPLICIT_VS_DERIVED"], alternatives: [explicit, model] };
        }
      } else if (unresolved(fields.model)) {
        warnings.push(modelReason === "UNBOUNDED" ? "DESCRIPTION_MODEL_UNBOUNDED" : "DESCRIPTION_HAS_NO_MODEL");
      }
    }
  }

  const anySupported = REGISTRATION_FIELD_KEYS.some((k) => fields[k].rawValue !== null);
  let overallStatus: VehicleRegistrationExtractionResult["overallStatus"];
  if (!anySupported) {
    warnings.push("NO_SUPPORTED_FIELDS");
    overallStatus = "FAILED";
  } else {
    // An OCR result can never satisfy this (no OCR field is HIGH) → it is always NEEDS_REVIEW.
    const criticalOk = CRITICAL_REGISTRATION_FIELDS.every((k) => {
      const f = fields[k];
      return f.normalizedValue !== null && f.confidence === "HIGH" && !f.warnings.includes("CONFLICT");
    });
    overallStatus = criticalOk ? "EXTRACTED" : "NEEDS_REVIEW";
  }

  return {
    parserVersion: REGISTRATION_PARSER_VERSION,
    documentKind: REGISTRATION_DOCUMENT_KIND,
    source: options.source,
    fields,
    overallStatus,
    warnings,
  };
}

/**
 * Whether a NATIVE-text result is worth keeping as the reading: at least one CRITICAL field
 * (plate, make, model, year, passengers, VIN, expiry) was actually resolved. A text layer that
 * yields nothing usable (an unsupported layout, garbled glyph order, a cover page) must not
 * dead-end the provider at manual entry — the service then offers the OCR choice instead.
 */
export function isNativeTextUsable(result: VehicleRegistrationExtractionResult): boolean {
  if (result.overallStatus === "FAILED") return false;
  return CRITICAL_REGISTRATION_FIELDS.some((k) => result.fields[k].normalizedValue !== null);
}

/**
 * Parse extracted PDF text into an allowlisted, PII-free result. `now` is injectable for
 * deterministic tests (bounds the manufacture-year ceiling). Owner/insurance PII lines are
 * discarded; only a document-level flag records that PII WAS present (never its value).
 */
export function parseOmanVehicleRegistration(text: string, now: Date = new Date()): VehicleRegistrationExtractionResult {
  const candidates: RegistrationCandidates = {};
  let piiSeen = false;

  for (const line of text.split(/\r?\n/)) {
    const m = matchLine(line);
    if (m.kind === "pii") { piiSeen = true; continue; }
    if (m.kind === "field") (candidates[m.field] ??= []).push({ text: m.rawValue });
  }

  return buildRegistrationExtraction(candidates, { source: REGISTRATION_EXTRACTION_SOURCE, now, piiSeen });
}
