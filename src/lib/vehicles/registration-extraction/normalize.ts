// Phase 3C — Vehicle Registration Extraction, Slice 2. Pure, deterministic
// normalization primitives. No I/O, no server-only, no floating-point for
// capacities/identifiers. Every function is total and returns null (never throws)
// for un-normalizable input, so the parser can attach explicit warnings.

// Arabic-Indic (U+0660–U+0669) and Extended Arabic-Indic / Persian (U+06F0–U+06F9)
// digit → Western ASCII digit. Code-point scan so no literal non-ASCII digit is relied on.
export function toWesternDigits(input: string): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0660 && cp <= 0x0669) out += String.fromCharCode(0x30 + (cp - 0x0660));
    else if (cp >= 0x06f0 && cp <= 0x06f9) out += String.fromCharCode(0x30 + (cp - 0x06f0));
    else out += ch;
  }
  return out;
}

// Remove bidirectional-control and zero-width characters that PDFs frequently embed
// around RTL text: LRM/RLM (200E/200F), embeddings/overrides (202A–202E), isolates
// (2066–2069), Arabic Letter Mark (061C), ZWSP/ZWNJ/ZWJ (200B–200D), BOM (FEFF).
const BIDI_ZERO_WIDTH = /[‎‏‪-‮⁦-⁩؜​-‍﻿]/g;
export function stripBidiAndZeroWidth(input: string): string {
  return input.replace(BIDI_ZERO_WIDTH, "");
}

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

// Arabic punctuation → ASCII equivalents (comma, semicolon, question mark, percent),
// plus full-width/small colon variants → ":". Deterministic and reversible enough for
// label matching; the authoritative rawValue is captured BEFORE this runs.
export function normalizePunctuation(input: string): string {
  return input
    .replace(/،/g, ",") // ، Arabic comma
    .replace(/؛/g, ";") // ؛ Arabic semicolon
    .replace(/؟/g, "?") // ؟ Arabic question mark
    .replace(/٪/g, "%") // ٪ Arabic percent
    .replace(/[：﹕]/g, ":"); // ：/﹕ full-width & small colon
}

/** Clean a line for LABEL matching: strip bidi/zero-width, normalize punctuation +
 *  whitespace. Does NOT convert digits (labels are non-numeric) and does NOT lowercase
 *  (Arabic is caseless; English labels are matched case-insensitively by the caller). */
export function cleanForMatching(input: string): string {
  return collapseWhitespace(normalizePunctuation(stripBidiAndZeroWidth(input)));
}

/** Clean a captured VALUE: strip bidi/zero-width + collapse whitespace, preserving the
 *  visible glyphs. Digit conversion is applied by the numeric normalizers, not here. */
export function cleanValue(input: string): string {
  return collapseWhitespace(stripBidiAndZeroWidth(input));
}

// ---- numeric / identifier normalizers (integer-only; never floating-point) ----

/** A bounded positive integer, or null. Accepts Arabic-Indic digits. Rejects decimals
 *  and any non-digit remainder (after unit stripping is the caller's job). */
export function parsePositiveInt(raw: string): number | null {
  const s = toWesternDigits(cleanValue(raw)).replace(/[,٫٬]/g, ""); // strip thousands/decimal separators used as grouping
  const m = s.match(/^(\d{1,9})$/);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** A manufacture/registration YEAR within [min, max], or null. */
export function parseYear(raw: string, min: number, max: number): number | null {
  const s = toWesternDigits(cleanValue(raw));
  const m = s.match(/(\d{4})/);
  if (!m) return null;
  const y = Number.parseInt(m[1]!, 10);
  return y >= min && y <= max ? y : null;
}

/** A measure (engine capacity / weight / load): an integer value plus a DETECTED unit
 *  token, or null. Never guesses a missing unit — `unit` is null when none is present. */
export function parseMeasure(raw: string): { value: number; unit: string | null } | null {
  const s = toWesternDigits(cleanValue(raw));
  const m = s.match(/(\d[\d,]{0,8})\s*([A-Za-z]{1,4}|سم٣|كجم|لتر)?/);
  if (!m) return null;
  const value = Number.parseInt(m[1]!.replace(/,/g, ""), 10);
  if (!Number.isInteger(value) || value <= 0) return null;
  const rawUnit = m[2] ? m[2].toLowerCase() : null;
  return { value, unit: rawUnit && rawUnit.length > 0 ? rawUnit : null };
}

/** VIN/chassis: uppercase ASCII, strip spaces/hyphens; report charset + length validity
 *  WITHOUT assuming every legacy vehicle has a modern 17-char VIN. Returns null only when
 *  the cleaned value is empty. `charsetOk` requires the 1981+ VIN alphabet (no I/O/Q). */
export function normalizeVin(raw: string): { vin: string; charsetOk: boolean; lengthOk: boolean } | null {
  const vin = toWesternDigits(cleanValue(raw)).toUpperCase().replace(/[\s-]/g, "");
  if (vin.length === 0) return null;
  const charsetOk = /^[A-HJ-NPR-Z0-9]+$/.test(vin);
  const lengthOk = vin.length === 17;
  return { vin, charsetOk, lengthOk };
}

/** Plate: collapse whitespace + uppercase Latin, but otherwise preserve the value (BARQ
 *  imposes NO Oman plate shape). Returns null for an empty value. The authoritative raw
 *  original is captured separately by the parser. */
export function normalizePlate(raw: string): string | null {
  const p = collapseWhitespace(toWesternDigits(cleanValue(raw))).toUpperCase();
  return p.length > 0 ? p : null;
}

const DATE_SEP = /[\/.\-]/;

/** Strict calendar date → ISO "YYYY-MM-DD", or null. Accepts YYYY-MM-DD and DD-MM-YYYY
 *  (and "/" or "." separators). Validates the day exists in that month/year (round-trips
 *  through UTC) — 2027-02-30 or 31/11/2026 are rejected. Never guesses a 2-digit year. */
export function parseIsoDate(raw: string): string | null {
  const s = toWesternDigits(cleanValue(raw));
  const m = s.match(/(\d{1,4})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{1,4})/);
  if (!m) return null;
  void DATE_SEP;
  let year: number, month: number, day: number;
  const a = Number.parseInt(m[1]!, 10);
  const b = Number.parseInt(m[2]!, 10);
  const c = Number.parseInt(m[3]!, 10);
  if (m[1]!.length === 4) {
    // YYYY-MM-DD
    year = a; month = b; day = c;
  } else if (m[3]!.length === 4) {
    // DD-MM-YYYY
    year = c; month = b; day = a;
  } else {
    return null; // ambiguous / 2-digit year → refuse to guess
  }
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
