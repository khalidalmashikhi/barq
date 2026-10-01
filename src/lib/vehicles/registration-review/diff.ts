// Phase 3C Slice 3A — PURE per-field decision/diff: given the EXTRACTED suggestion and the
// provider-CONFIRMED value for each field, classify whether the provider matched the suggestion,
// corrected it, or entered it manually (no suggestion). Stored as the bounded `fieldDecisions`
// JSON (metadata only — never raw text, never PII).

import { CONFIRMATION_FIELD_KEYS, CONFIRMATION_FIELDS, type ConfirmationFieldKey } from "./field-model";
import type { ConfirmationValues } from "./confirmation-input";

export type FieldDecisionSource = "EXTRACTED" | "PROVIDER" | "MANUAL";
export type FieldDecision = { matches: boolean; source: FieldDecisionSource };
export type FieldDecisions = Partial<Record<ConfirmationFieldKey, FieldDecision>>;

/** Extracted suggestions already mapped to confirmation keys (null when the parser had none). */
export type ExtractedByField = Partial<Record<ConfirmationFieldKey, string | number | null>>;

export function computeFieldDecisions(extracted: ExtractedByField, confirmed: ConfirmationValues): FieldDecisions {
  const out: FieldDecisions = {};
  for (const key of CONFIRMATION_FIELD_KEYS) {
    const confirmedValue = confirmed[key];
    if (confirmedValue === null || confirmedValue === undefined) continue; // no claim for this field
    const hasSuggestion = CONFIRMATION_FIELDS[key].extractionKey !== null;
    const extractedValue = extracted[key] ?? null;
    if (!hasSuggestion || extractedValue === null) {
      // Provider supplied a value the parser could not (manual entry).
      out[key] = { matches: false, source: "MANUAL" };
      continue;
    }
    const matches = String(extractedValue) === String(confirmedValue);
    out[key] = { matches, source: matches ? "EXTRACTED" : "PROVIDER" };
  }
  return out;
}

/** Count of fields the provider corrected away from a real suggestion (for a safe summary). */
export function correctedFieldCount(decisions: FieldDecisions): number {
  return Object.values(decisions).filter((d) => d && d.source === "PROVIDER").length;
}
