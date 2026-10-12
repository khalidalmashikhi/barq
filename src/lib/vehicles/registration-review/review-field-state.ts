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
//   • Unsaved NON-SENSITIVE values survive a language switch through bound tab memory (see below);
//     private registration values never leave transient memory.

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

/** A stable fingerprint of the server data the form starts from (re-sync trigger; never shown). */
export function reviewFieldsSignature(fields: readonly ReviewFieldStateInput[]): string {
  return fields.map((f) => [f.key, f.extractedValue ?? "", f.confirmedValue ?? "", f.heuristic === true ? 1 : 0, f.completedAutomatically === true ? 1 : 0].join("\u0001")).join("\u0002");
}

// ── Tab memory (2026-10-12 correction) ────────────────────────────────────────────────────────────
// A language switch is a client navigation that REMOUNTS the form, so its in-memory state is gone.
// Unsaved NON-SENSITIVE review state survives through the tab's sessionStorage (one record per
// vehicle). The record is BOUND to the signed-in provider (opaque server hash), the document +
// reading it was typed against (opaque server hash), and the form (onboarding vs detail), and keeps
// each field's ORIGIN (typed vs applied suggestion) so provenance is never collapsed. Anything that
// does not match — another provider, vehicle, form, document or reading, an older format, garbage —
// decodes to NOTHING. Private registration values are never serialized: the allowlist below is
// enforced at encode AND decode time.

/** The ONLY confirmation fields that may be written to tab memory: the customer-visible, non-sensitive
 *  group. Every PRIVATE registration field (capacities from the card, plate, VIN, engine number,
 *  usage, weights, axles, registration dates…) stays in transient memory only. */
export const TAB_MEMORY_FIELD_KEYS: readonly string[] = ["make", "model", "modelYear", "color", "bookablePassengerCapacity"];

/** Non-field onboarding choices that may be remembered (non-sensitive; never a declaration). */
export const TAB_MEMORY_EXTRA_KEYS: readonly string[] = ["vehicleType", "publicDescription", "claimedFourByFour"];

/** Longest value kept per entry (public description included); longer input is simply not kept. */
export const TAB_MEMORY_MAX_VALUE_LENGTH = 2000;

export type TabMemoryOrigin = "TYPED" | "APPLIED";
export type TabMemoryFlow = "ONBOARDING" | "DETAIL";
/** Opaque server-computed binding (hashes — no raw id, no document value). */
export type ReviewTabBinding = { identity: string; source: string };
export type ReviewTabMemory = {
  fields: Record<string, { origin: TabMemoryOrigin; value: string }>;
  extras: Record<string, string>;
};

const TAB_MEMORY_VERSION = 2;

export function emptyTabMemory(): ReviewTabMemory {
  return { fields: {}, extras: {} };
}

/** True when a field's unsaved value may be written to tab memory. */
export function isTabMemoryField(key: string): boolean {
  return TAB_MEMORY_FIELD_KEYS.includes(key);
}

const keepable = (v: unknown): v is string => typeof v === "string" && v.length <= TAB_MEMORY_MAX_VALUE_LENGTH;

/** Serialize — ONLY allowlisted keys, only with a complete binding; null = nothing to keep. */
export function encodeTabMemory(memory: ReviewTabMemory, binding: ReviewTabBinding | null, flow: TabMemoryFlow): string | null {
  if (!binding || !binding.identity || !binding.source) return null;
  const f: Record<string, [string, string]> = {};
  for (const [k, e] of Object.entries(memory.fields)) {
    if (!isTabMemoryField(k) || !e || !keepable(e.value)) continue;
    if (e.origin === "APPLIED" && !isBlank(e.value)) f[k] = ["A", e.value];
    else if (e.origin === "TYPED") f[k] = ["T", e.value];
  }
  const x: Record<string, string> = {};
  for (const [k, v] of Object.entries(memory.extras)) if (TAB_MEMORY_EXTRA_KEYS.includes(k) && keepable(v) && v !== "") x[k] = v;
  if (Object.keys(f).length === 0 && Object.keys(x).length === 0) return null;
  return JSON.stringify({ v: TAB_MEMORY_VERSION, u: binding.identity, s: binding.source, k: flow, f, x });
}

/** Deserialize — only a record for THIS provider, THIS document reading and THIS form; anything else
 *  (and every non-allowlisted key, however it got there) decodes to nothing. */
export function decodeTabMemory(raw: string | null, binding: ReviewTabBinding | null, flow: TabMemoryFlow): ReviewTabMemory {
  const out = emptyTabMemory();
  if (!raw || !binding || !binding.identity || !binding.source) return out;
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object" || Array.isArray(p)) return out;
    const { v, u, s, k, f, x } = p as Record<string, unknown>;
    if (v !== TAB_MEMORY_VERSION || u !== binding.identity || s !== binding.source || k !== flow) return out;
    if (f && typeof f === "object" && !Array.isArray(f)) {
      for (const [key, e] of Object.entries(f as Record<string, unknown>)) {
        if (!isTabMemoryField(key) || !Array.isArray(e) || e.length !== 2 || !keepable(e[1])) continue;
        if (e[0] === "T") out.fields[key] = { origin: "TYPED", value: e[1] };
        else if (e[0] === "A" && !isBlank(e[1])) out.fields[key] = { origin: "APPLIED", value: e[1] };
      }
    }
    if (x && typeof x === "object" && !Array.isArray(x)) {
      for (const [key, val] of Object.entries(x as Record<string, unknown>)) if (TAB_MEMORY_EXTRA_KEYS.includes(key) && keepable(val)) out.extras[key] = val;
    }
    return out;
  } catch {
    return out;
  }
}

/** Record ONE field's unsaved value (or remove it). A typed value equal to the starting value is not
 *  an unsaved change and is dropped; a non-allowlisted key is never recorded. */
export function rememberField(memory: ReviewTabMemory, f: ReviewFieldStateInput, value: string, origin: TabMemoryOrigin): ReviewTabMemory {
  const fields = { ...memory.fields };
  delete fields[f.key];
  if (isTabMemoryField(f.key) && !(origin === "TYPED" && value === initialFieldValue(f))) fields[f.key] = { origin, value };
  return { ...memory, fields };
}

/** What a remount may put back. TYPED values come back as typed (provider provenance kept). An
 *  APPLIED suggestion comes back only while it still equals the server's CURRENT suggestion and the
 *  field would otherwise start blank — so it keeps its "selected" provenance and never overwrites. */
export function restoreTabMemory(memory: ReviewTabMemory, fields: readonly ReviewFieldStateInput[]): { values: Record<string, string>; applied: Record<string, boolean> } {
  const values: Record<string, string> = {};
  const applied: Record<string, boolean> = {};
  for (const f of fields) {
    const e = memory.fields[f.key];
    if (!e || !isTabMemoryField(f.key)) continue;
    if (e.origin === "TYPED") {
      values[f.key] = e.value;
      applied[f.key] = false;
    } else if (APPLY_SUGGESTION_KEYS.includes(f.key) && e.value === suggestionText(f) && isBlank(initialFieldValue(f))) {
      values[f.key] = e.value;
      applied[f.key] = true;
    }
  }
  return { values, applied };
}

/** Unsaved changes in fields that are NEVER written to tab memory (private registration state): these
 *  would be lost by a remount, so a language switch must not proceed silently. */
export function hasUnsavedPrivateChanges(values: Readonly<Record<string, string>>, fields: readonly ReviewFieldStateInput[]): boolean {
  return fields.some((f) => !isTabMemoryField(f.key) && (values[f.key] ?? "") !== initialFieldValue(f));
}

/** Fields whose CURRENT value differs from what the form started with (unsaved changes). */
export function hasUnsavedChanges(values: Readonly<Record<string, string>>, fields: readonly ReviewFieldStateInput[]): boolean {
  return fields.some((f) => (values[f.key] ?? "") !== initialFieldValue(f));
}
