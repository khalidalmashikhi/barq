// Phase 3C (incomplete native-PDF correction, 2026-10-09) — PURE rules for the two recovery paths
// of a registration reading that is current but incomplete, or stored under an older semantic
// version. No I/O; shared by the server service, the review read model and the tests.
//
//   • isIdentityIncomplete — the server-side completeness rule: a reading is INCOMPLETE when the
//     customer-visible identity (manufacturer + commercial model) is still missing. A CONFLICT is
//     not "missing" (the provider picks one of the values shown); provider-entered/private fields
//     (bookable passengers, seats when not printed, the provider's description, optional private
//     fields) never count.
//   • mergeCompletion — how an optional, consent-gated automatic reading ENRICHES a current local
//     (native PDF text) reading. It never blindly replaces it:
//       1. a valid EXPLICIT native value stays authoritative (a differing automatic reading is only
//          flagged for review);
//       2. an automatic value may FILL a field the local reading left unresolved;
//       3. agreement keeps the local value — it never upgrades anything to "verified";
//       4. a DERIVED (heuristic) local value that disagrees becomes a CONFLICT with both values —
//          nothing is chosen silently;
//       5. an existing local CONFLICT stays a conflict.
//     Provider edits and the provider's vehicle-type choice live outside the extraction row and are
//     never touched here. Every filled value remains a suggestion the provider confirms.
//   • candidatesFromStoredFields — rebuilds the per-field text candidates of a STORED automatic
//     reading so a stale one can be re-derived LOCALLY under the current rules, with no new
//     external request. Derived fields are skipped (they are re-derived from the description).

import { foldForMatching } from "./normalize";
import { REGISTRATION_FIELD_KEYS, type RegistrationCandidates, type RegistrationFieldKey, type VehicleRegistrationField, type VehicleRegistrationFields } from "./types";

/** Document-level marker: an automatic completion was merged into this reading. */
export const COMPLETION_APPLIED_WARNING = "AUTOMATIC_COMPLETION_APPLIED";
/** Document-level marker: the last completion attempt failed; the local reading was kept. */
export const COMPLETION_FAILED_WARNING = "AUTOMATIC_COMPLETION_FAILED";
/** Document-level marker: a stale stored automatic reading was re-derived locally. */
export const REDERIVED_LOCALLY_WARNING = "REDERIVED_LOCALLY";
/** Field-level: the value was filled by the automatic completion. */
export const FROM_COMPLETION_WARNING = "FROM_AUTOMATIC_COMPLETION";
/** Field-level: an explicit local value differs from the automatic reading (kept, flagged). */
export const COMPLETION_DIFFERS_WARNING = "AUTOMATIC_READING_DIFFERS";
/** Field-level: a derived local value and the automatic reading disagree (conflict). */
export const COMPLETION_CONFLICT_WARNING = "NATIVE_VS_AUTOMATIC";

/** The customer-visible identity a reading must carry to be "complete" for this workflow. */
export const IDENTITY_KEYS = ["makeDescription", "model"] as const satisfies readonly RegistrationFieldKey[];

type AnyField = VehicleRegistrationField<string | number>;
type StoredFieldLike = { rawValue: string | null; normalizedValue: string | number | null; confidence: string; warnings: string[]; alternatives?: (string | number)[] };

function isMissing(field: StoredFieldLike | undefined | null): boolean {
  if (!field) return true;
  if (field.warnings.includes("CONFLICT")) return false;
  return field.normalizedValue === null;
}

/** INCOMPLETE when the manufacturer or the commercial model is missing (a conflict is not missing). */
export function isIdentityIncomplete(fields: Partial<Record<RegistrationFieldKey, StoredFieldLike | undefined>> | null | undefined): boolean {
  if (!fields) return true;
  return IDENTITY_KEYS.some((k) => isMissing(fields[k]));
}

function sameValue(a: string | number, b: string | number): boolean {
  if (typeof a === "number" || typeof b === "number") return String(a) === String(b);
  return foldForMatching(a) === foldForMatching(b);
}

function isExplicit(field: AnyField): boolean {
  return field.normalizedValue !== null && !field.warnings.includes("HEURISTIC_SPLIT") && field.confidence !== "LOW";
}

function withWarning(field: AnyField, code: string): AnyField {
  return field.warnings.includes(code) ? field : { ...field, warnings: [...field.warnings, code] };
}

export type CompletionMergeResult = {
  fields: VehicleRegistrationFields;
  /** Counts only — for the audit record. Never values. */
  filled: number;
  conflicts: number;
  differs: number;
};

export function mergeCompletion(local: VehicleRegistrationFields, automatic: VehicleRegistrationFields): CompletionMergeResult {
  const out = { ...local } as Record<RegistrationFieldKey, AnyField>;
  let filled = 0;
  let conflicts = 0;
  let differs = 0;
  for (const key of REGISTRATION_FIELD_KEYS) {
    const n = local[key] as AnyField;
    const e = automatic[key] as AnyField;
    if (!e) continue;
    // 5. a local conflict stays exactly as it is.
    if (n.warnings.includes("CONFLICT")) continue;
    const eConflict = e.warnings.includes("CONFLICT");
    const eValue = e.normalizedValue;
    // 2. fill an unresolved local field (an automatic conflict is carried over as a conflict).
    if (n.normalizedValue === null) {
      if (eValue === null && !eConflict) continue;
      out[key] = withWarning({ ...e, confidence: e.confidence === "HIGH" ? "MEDIUM" : e.confidence }, FROM_COMPLETION_WARNING);
      filled++;
      continue;
    }
    if (eValue === null) continue; // nothing to compare against
    if (sameValue(n.normalizedValue, eValue)) continue; // 3. agreement — local value kept, nothing upgraded
    if (isExplicit(n)) {
      // 1. explicit local value stays authoritative; the disagreement is flagged for review.
      out[key] = withWarning(n, COMPLETION_DIFFERS_WARNING);
      differs++;
      continue;
    }
    // 4. a derived/LOW local value disagreeing with the automatic reading → CONFLICT, nothing chosen.
    out[key] = {
      rawValue: n.rawValue,
      normalizedValue: null,
      confidence: "LOW",
      warnings: ["CONFLICT", COMPLETION_CONFLICT_WARNING],
      alternatives: [n.normalizedValue, eValue].slice(0, 4),
    };
    conflicts++;
  }
  return { fields: out as unknown as VehicleRegistrationFields, filled, conflicts, differs };
}

/** Rebuild per-field text candidates from a STORED automatic reading, for a local re-derivation
 *  under the current rules. A conflict contributes each of its values; a field derived from the
 *  description is skipped (the current rules derive it again from the description). */
export function candidatesFromStoredFields(fields: Partial<Record<RegistrationFieldKey, StoredFieldLike | undefined>>): RegistrationCandidates {
  const out: RegistrationCandidates = {};
  for (const key of REGISTRATION_FIELD_KEYS) {
    const f = fields[key];
    if (!f) continue;
    if (f.warnings.includes("HEURISTIC_SPLIT")) continue;
    const unclear = f.warnings.includes("OCR_UNCLEAR");
    if (f.warnings.includes("CONFLICT") && Array.isArray(f.alternatives) && f.alternatives.length > 0) {
      out[key] = f.alternatives.map((v) => ({ text: String(v), unclear }));
    } else if (typeof f.rawValue === "string" && f.rawValue.trim().length > 0) {
      out[key] = [{ text: f.rawValue, unclear }];
    }
  }
  return out;
}
