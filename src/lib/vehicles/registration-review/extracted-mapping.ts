// Phase 3C Slice 3A — PURE mapping of a stored extraction's `fields` JSON to per-confirmation-field
// suggestions + confidence. Safely parses the Slice-2 persisted-fields shape; a malformed/absent
// blob yields empty suggestions (fail-soft — the provider then enters values manually).

import { persistedFieldsSchema } from "@/lib/vehicles/registration-extraction/record";
import type { RegistrationFieldConfidence } from "@/lib/vehicles/registration-extraction/codes";
import { CONFIRMATION_FIELD_KEYS, CONFIRMATION_FIELDS, type ConfirmationFieldKey } from "./field-model";
import type { ExtractedByField } from "./diff";

export type ExtractedSuggestions = {
  values: ExtractedByField;
  confidence: Partial<Record<ConfirmationFieldKey, RegistrationFieldConfidence>>;
  warnings: Partial<Record<ConfirmationFieldKey, string[]>>;
};

export function mapExtractedByField(fieldsJson: unknown): ExtractedSuggestions {
  const values: ExtractedByField = {};
  const confidence: ExtractedSuggestions["confidence"] = {};
  const warnings: ExtractedSuggestions["warnings"] = {};

  const parsed = persistedFieldsSchema.safeParse(fieldsJson);
  if (!parsed.success) return { values, confidence, warnings };
  const fields = parsed.data as Record<string, { normalizedValue: string | number | null; confidence: RegistrationFieldConfidence; warnings: string[] }>;

  for (const key of CONFIRMATION_FIELD_KEYS) {
    const exKey = CONFIRMATION_FIELDS[key].extractionKey;
    if (!exKey) continue;
    const f = fields[exKey];
    if (!f) continue;
    values[key] = f.normalizedValue;
    confidence[key] = f.confidence;
    warnings[key] = f.warnings;
  }
  return { values, confidence, warnings };
}
