// Phase 3C (review UX correction, 2026-10-11) — PURE, isomorphic rules for the provider's review
// form: what a field STARTS with, what its status line SAYS, and when a document suggestion may be
// APPLIED by the provider. No I/O, no server action, no network: the form calls these to update its
// local state only; the existing finalize path and server validators stay authoritative.
//
// STAGING FINDING this fixes: the form created its local values ONCE on mount. When the review
// re-rendered in place with NEW suggestions (e.g. after "Read document again"), an empty input no
// longer equalled the new starting value, so it was treated as "edited by you": the field showed
// "أدخلته أنت" while the provider had typed nothing, and the suggestion appeared only as a passive
// "اقتراح النظام: …" line with no way to apply it.
//
// CONTRACT
//   • A DERIVED / automatically completed make or commercial model (low-confidence suggestion) is
//     NEVER pre-filled: the input starts empty and the provider applies it with one explicit tap.
//     Direct, labelled document values keep pre-filling for review as before.
//   • Status (deterministic, from the current input value) — ONE contract for the onboarding review
//     AND the vehicle-detail confirmation form (2026-10-12 parity):
//       NOT_ENTERED — blank (empty / whitespace) and nothing suggested
//       SUGGESTED   — blank and a document suggestion exists ("not confirmed")
//       APPLIED     — the provider applied the suggestion IN THIS FORM and it is unchanged
//       SOURCE      — the untouched value IS the document's current value (reliable: compared live
//                     with the current reading) → the existing document / OCR wording
//       CURRENT     — an untouched SAVED value that the current reading does not confirm: the
//                     persisted record cannot prove who typed it (a re-read may have changed the
//                     reading since), so it is shown neutrally as "Current value"
//       PROVIDER    — anything the provider typed or changed in this form
//     A blank value is never "entered by you", and a saved value is never re-labelled as typed.
//   • Apply is offered only for make / model, only while the input is blank — it never replaces
//     something the provider typed — and it changes ONLY that field.
//   • Fields the provider has not touched follow the server when the review re-renders with new
//     suggestions; touched fields keep the provider's value.

import { formatIsoDateForDisplay } from "./date-display";

export type ReviewFieldStateInput = {
  key: string;
  kind: "text" | "int" | "date" | "vin" | "plate";
  extractedValue: string | number | null;
  confirmedValue: string | number | null;
  source: "NATIVE_PDF_TEXT" | "OCR" | "PROVIDER" | "UNRESOLVED";
  heuristic?: boolean;
  completedAutomatically?: boolean;
};

/** The only fields with a one-tap "Use <suggestion>" action. */
export const APPLY_SUGGESTION_KEYS: readonly string[] = ["make", "model"];

export type ReviewFieldStatus = "NOT_ENTERED" | "SUGGESTED" | "APPLIED" | "SOURCE" | "CURRENT" | "PROVIDER";

export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

function display(f: ReviewFieldStateInput, v: string | number): string {
  return f.kind === "date" ? formatIsoDateForDisplay(String(v)) : String(v);
}

/** A make / model whose document value is only a low-confidence SUGGESTION (derived from the
 *  printed description, or filled by the automatic completion) — never pre-filled. */
export function isSuggestionOnly(f: ReviewFieldStateInput): boolean {
  return APPLY_SUGGESTION_KEYS.includes(f.key) && f.extractedValue !== null && (f.heuristic === true || f.completedAutomatically === true);
}

/** The document suggestion as the input would show it, or null when there is none. */
export function suggestionText(f: ReviewFieldStateInput): string | null {
  if (f.extractedValue === null || f.extractedValue === undefined) return null;
  const s = display(f, f.extractedValue);
  return isBlank(s) ? null : s;
}

/** What the input starts with: the provider's own saved value, else a DIRECT document value; a
 *  suggestion-only make/model starts EMPTY. */
export function initialFieldValue(f: ReviewFieldStateInput): string {
  if (f.confirmedValue !== null && f.confirmedValue !== undefined) return display(f, f.confirmedValue);
  if (isSuggestionOnly(f)) return "";
  return f.extractedValue === null || f.extractedValue === undefined ? "" : display(f, f.extractedValue);
}

/** The truthful status of a field for its CURRENT input value. `applied` = the provider pressed
 *  "Use <suggestion>" for this field in the current form. */
export function fieldStatus(f: ReviewFieldStateInput, value: string | undefined, applied: boolean): ReviewFieldStatus {
  if (isBlank(value)) return suggestionText(f) !== null ? "SUGGESTED" : "NOT_ENTERED";
  const v = value as string;
  const suggestion = suggestionText(f);
  if (applied && suggestion !== null && v === suggestion) return "APPLIED";
  const initial = initialFieldValue(f);
  if (isBlank(initial) || v !== initial) return "PROVIDER"; // typed / changed in this form
  // Untouched starting value.
  if (suggestion !== null && v === suggestion) return "SOURCE"; // it IS the current document value
  return f.confirmedValue !== null && f.confirmedValue !== undefined ? "CURRENT" : "SOURCE";
}

/** The ONE message key for a status (both forms). SOURCE keeps the document / OCR wording; a SOURCE
 *  without a document source (cannot normally happen) falls back to the neutral "Current value". */
export function statusLabelKey(status: ReviewFieldStatus, source: ReviewFieldStateInput["source"]): string {
  switch (status) {
    case "NOT_ENTERED":
      return "vehicleRegStatusNotEntered";
    case "SUGGESTED":
      return "vehicleRegStatusSuggested";
    case "APPLIED":
      return "vehicleRegStatusApplied";
    case "PROVIDER":
      return "vehicleRegSourceProvider";
    case "CURRENT":
      return "vehicleRegStatusCurrent";
    case "SOURCE":
      return source === "NATIVE_PDF_TEXT" ? "vehicleRegSourceDocument" : source === "OCR" ? "vehicleRegSourceOcr" : "vehicleRegStatusCurrent";
  }
}

/** True when the status describes the DOCUMENT's value (confidence / derived chips apply). */
export function describesDocument(status: ReviewFieldStatus): boolean {
  return status === "SOURCE" || status === "SUGGESTED" || status === "APPLIED";
}

/** The "Use <suggestion>" action is offered only for make/model, only while the input is blank. */
export function canApplySuggestion(f: ReviewFieldStateInput, value: string | undefined): boolean {
  return APPLY_SUGGESTION_KEYS.includes(f.key) && suggestionText(f) !== null && isBlank(value);
}

/** Apply ONE field's suggestion — returns a new record changing only that key (or the same record
 *  when applying is not allowed, e.g. the provider already typed something). */
export function applySuggestion(values: Readonly<Record<string, string>>, f: ReviewFieldStateInput): Record<string, string> {
  if (!canApplySuggestion(f, values[f.key])) return values as Record<string, string>;
  return { ...values, [f.key]: suggestionText(f)! };
}

/** When the review re-renders with new server data, fields the provider has NOT touched follow the
 *  server; touched fields keep the provider's value. */
export function syncUntouchedValues(values: Readonly<Record<string, string>>, touched: Readonly<Record<string, boolean>>, fields: readonly ReviewFieldStateInput[]): Record<string, string> {
  const next: Record<string, string> = { ...values };
  for (const f of fields) if (!touched[f.key]) next[f.key] = initialFieldValue(f);
  return next;
}

/** Applied suggestions remembered in the tab (the same per-vehicle session mechanism as the
 *  vehicle-type choice, for a language switch or reload) are restored ONLY when they still equal the
 *  server's CURRENT suggestion and the field would otherwise start blank. Anything else is dropped. */
export function restorableAppliedSuggestions(stored: unknown, fields: readonly ReviewFieldStateInput[]): Record<string, string> {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (!APPLY_SUGGESTION_KEYS.includes(f.key)) continue;
    const v = (stored as Record<string, unknown>)[f.key];
    if (typeof v !== "string") continue;
    if (v === suggestionText(f) && isBlank(initialFieldValue(f))) out[f.key] = v;
  }
  return out;
}

/** A stable fingerprint of the server data the form starts from (re-sync trigger; never shown). */
export function reviewFieldsSignature(fields: readonly ReviewFieldStateInput[]): string {
  return fields.map((f) => [f.key, f.extractedValue ?? "", f.confirmedValue ?? "", f.heuristic === true ? 1 : 0, f.completedAutomatically === true ? 1 : 0].join("\u0001")).join("\u0002");
}

/**
 * Session-storage encoding of the applied make/model suggestions (only those two keys, strings),
 * bound to the SOURCE READING they came from (`sourceToken`, an opaque marker of the current
 * reading — e.g. when it last succeeded). A remembered suggestion is never restored once the
 * document or its reading changed, even if the suggested text happens to be the same.
 */
export function encodeAppliedSuggestions(applied: Readonly<Record<string, string>>, sourceToken: string | null): string | null {
  if (!sourceToken) return null;
  const entries = Object.entries(applied).filter(([k, v]) => APPLY_SUGGESTION_KEYS.includes(k) && typeof v === "string" && !isBlank(v));
  return entries.length === 0 ? null : JSON.stringify({ s: sourceToken, v: Object.fromEntries(entries) });
}

/** The remembered values — only when they belong to the CURRENT source reading; anything else
 *  (another reading, the older unbound format, garbage) decodes to nothing. */
export function decodeAppliedSuggestions(raw: string | null, sourceToken: string | null): Record<string, string> {
  if (!raw || !sourceToken) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const { s, v } = parsed as { s?: unknown; v?: unknown };
    if (s !== sourceToken || !v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter((e): e is [string, string] => APPLY_SUGGESTION_KEYS.includes(e[0]) && typeof e[1] === "string"));
  } catch {
    return {};
  }
}

/** Fields whose CURRENT value differs from what the form started with (unsaved changes). */
export function hasUnsavedChanges(values: Readonly<Record<string, string>>, fields: readonly ReviewFieldStateInput[]): boolean {
  return fields.some((f) => (values[f.key] ?? "") !== initialFieldValue(f));
}
