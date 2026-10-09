// Phase 3C (Arabic-iPhone date correction, 2026-10-09) — PURE date presentation for the review
// screens. Canonical storage and submission are ISO "YYYY-MM-DD" strings; the UI shows and accepts
// an unambiguous DAY/MONTH/YEAR form with Western digits ("26/06/2026") in EVERY interface
// language, rendered inside an LTR isolate so a right-to-left page can never reorder the parts.
//
// Everything here is string arithmetic: no Date object, no time zone, no device locale — so a
// value can never shift by a day between Muscat, the server and the browser. No I/O.

import { parseIsoDate, toWesternDigits, cleanValue } from "@/lib/vehicles/registration-extraction/normalize";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO "YYYY-MM-DD" → "DD/MM/YYYY" (Western digits). Anything else → "" (never a guess). */
export function formatIsoDateForDisplay(iso: string | null | undefined): string {
  if (typeof iso !== "string") return "";
  const m = ISO.exec(iso);
  if (!m || parseIsoDate(iso) !== iso) return ""; // an impossible date (13th month, 30 Feb) is never shown
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Typed input ("26/06/2026", "26-06-2026", "2026-06-26", Arabic-Indic digits allowed) → canonical
 *  ISO, or null when it is not an unambiguous, existing calendar date. Two-digit years are refused. */
export function parseDisplayedDate(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const s = toWesternDigits(cleanValue(text));
  if (s.length === 0) return null;
  return parseIsoDate(s);
}

/** What the form SUBMITS for a date field: the canonical ISO when the text is a valid date,
 *  otherwise the text itself (so the server reports INVALID_DATE for that exact field). Empty → "". */
export function dateFieldSubmissionValue(text: string): string {
  const trimmed = cleanValue(text);
  if (trimmed.length === 0) return "";
  return parseDisplayedDate(trimmed) ?? trimmed;
}

/** The placeholder shown in the date input — the same in every language (digits are universal). */
export const DATE_INPUT_PLACEHOLDER = "DD/MM/YYYY";
