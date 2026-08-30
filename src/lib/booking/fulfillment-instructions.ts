import { Prisma } from "@prisma/client";
import type { Bilingual } from "@/lib/services/service-info";

// BOOKING FULFILLMENT LOGISTICS — the single, server-authoritative parser/reader/localizer for
// Booking.fulfillmentInstructions (the booking-SPECIFIC meeting/pickup instructions a provider
// authors AFTER acceptance). This is a booking-scoped mirror of the SAME bilingual-text
// convention service-info.ts already established for Service.startInstructions:
//   • trim both languages; either language may be blank (the provider is not forced to write both)
//   • both blank  → null (clear the column)
//   • over the per-language char ceiling → invalid (fail closed)
//   • read side parses the untyped Json column fail-closed
//   • rendered as TEXT ONLY — never HTML, never a contact channel (policy §14)
// Deliberately a small, self-contained module (its own copy of the ~15 lines of shared rules,
// re-using only the Bilingual TYPE) so the booking domain does not depend on the services domain
// for a runtime helper. Pure (no I/O) and exhaustively unit-testable.

export type { Bilingual };

// Per-language character ceiling — matches service-info's TEXT_MAX (start instructions). A meeting
// instruction is a short paragraph; this is an anti-abuse bound, not a business rule.
export const FULFILLMENT_TEXT_MAX = 1_000;

export type ParseFulfillmentResult =
  // value === null  → clear the column (both languages blank)
  // value: Bilingual → set the column
  | { ok: true; value: Bilingual | null }
  | { ok: false };

function str(v: FormDataEntryValue | null): string | null {
  return typeof v === "string" ? v : v === null ? null : ""; // a File becomes "" (never valid)
}

/**
 * Parse + validate the two fulfillment-instruction textareas from a FormData submission.
 * Unlike the tri-state service-info parser, this is a single dedicated field with a binary intent:
 * the provider is either setting instructions or clearing them, so an absent key is treated the
 * same as an empty one (→ clear). Returns { ok:false } on an over-length value (caller → INVALID_INPUT).
 */
export function parseFulfillmentInstructionsForm(formData: FormData): ParseFulfillmentResult {
  const ar = (str(formData.get("fulfillmentInstructionsAr")) ?? "").trim();
  const en = (str(formData.get("fulfillmentInstructionsEn")) ?? "").trim();
  if (ar.length > FULFILLMENT_TEXT_MAX || en.length > FULFILLMENT_TEXT_MAX) return { ok: false };
  if (ar === "" && en === "") return { ok: true, value: null };
  return { ok: true, value: { ar, en } };
}

// A concrete value → its Prisma write value; null → Prisma.DbNull (clear the column).
export function fulfillmentInstructionsWrite(
  value: Bilingual | null,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

// ── Read side (fail-closed parsing of the untyped Json column) ────────────────────────
export function readFulfillmentInstructions(value: unknown): Bilingual | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  const ar = typeof o.ar === "string" ? o.ar : "";
  const en = typeof o.en === "string" ? o.en : "";
  return ar.trim() === "" && en.trim() === "" ? null : { ar, en };
}

// Booking fulfillment text is bilingual (ar/en) only; non-Arabic UI locales fall back to English,
// Arabic UI falls back to English then vice-versa — identical to service-info's pick().
function pick(b: Bilingual, locale: string): string {
  const isAr = locale.toLowerCase().startsWith("ar");
  const primary = isAr ? b.ar : b.en;
  const fallback = isAr ? b.en : b.ar;
  return (primary.trim() !== "" ? primary : fallback).trim();
}

/** Localize the fulfillment instructions for a viewer. Returns null when there is no usable text
 *  (so the UI renders NOTHING rather than an empty block). */
export function localizeFulfillmentInstructions(value: unknown, locale: string): string | null {
  const raw = readFulfillmentInstructions(value);
  if (!raw) return null;
  const v = pick(raw, locale);
  return v === "" ? null : v;
}
