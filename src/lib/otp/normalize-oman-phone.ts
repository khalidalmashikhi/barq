// Authoritative server-side Oman phone canonicalization — P0-1 security gate
// (OTP / SMS-pumping hardening).
//
// BARQ phone authentication is Oman-only for the current launch scope. This is
// the SINGLE source of truth that turns every accepted user input into ONE
// canonical E.164 identity `+968XXXXXXXX` (8 national digits). It is wired into
// the Better Auth `hooks.before` for BOTH /phone-number/send-otp and
// /phone-number/verify (src/lib/auth/server.ts), so the resend cooldown, the
// daily send cap, the plugin's Verification.identifier, Twilio delivery, the
// verify lookup, and the resulting User identity ALL key on the same canonical
// value — equivalent textual forms can neither bypass the per-number rate limits
// nor fragment identity.
//
// A pure function with no I/O and no logging — it never touches or emits the raw
// phone number, and never silently reinterprets a number carrying a non-Oman
// country code as an Oman number (those are rejected, not coerced).
//
// ACCEPTED representations (all canonicalize to `+96898115159`):
//   98115159          bare 8 national digits
//   +96898115159      E.164
//   96898115159       country code without '+', 11 digits
//   0096898115159     '00' international prefix + 968 + 8 digits
//   any of the above with spaces / dashes / parentheses / dots
// REJECTED:
//   wrong national length (not exactly 8), non-digit garbage, empty,
//   any explicit non-+968 country code (e.g. +971…, +1…, 0097150…),
//   a leading domestic-trunk '0' form (not a standard Oman representation).

export type NormalizeOmanPhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: "EMPTY" | "INVALID_CHARACTERS" | "UNSUPPORTED_COUNTRY" | "INVALID_LENGTH" };

const NATIONAL_8 = /^\d{8}$/;
// Optional single leading '+' followed by digits only (after formatting is stripped).
const PLUS_DIGITS = /^\+?\d+$/;
// Whitespace (incl. non-breaking), dashes, parentheses, dots — cosmetic only.
const FORMATTING = /[\s ().-]/g;

/** Canonicalize a user-entered Oman phone number to `+968XXXXXXXX`, or reject it. */
export function normalizeOmanPhone(input: string): NormalizeOmanPhoneResult {
  if (typeof input !== "string") return { ok: false, reason: "EMPTY" };

  const cleaned = input.trim().replace(FORMATTING, "");
  if (cleaned === "") return { ok: false, reason: "EMPTY" };
  if (!PLUS_DIGITS.test(cleaned)) return { ok: false, reason: "INVALID_CHARACTERS" };

  let national: string;

  if (cleaned.startsWith("+")) {
    // Explicit country code — only +968 is supported; never coerce another country.
    if (!cleaned.startsWith("+968")) return { ok: false, reason: "UNSUPPORTED_COUNTRY" };
    national = cleaned.slice(4);
  } else if (cleaned.startsWith("00")) {
    // '00' international dialing prefix — only 00968 is supported.
    if (!cleaned.startsWith("00968")) return { ok: false, reason: "UNSUPPORTED_COUNTRY" };
    national = cleaned.slice(5);
  } else if (cleaned.length === 11 && cleaned.startsWith("968")) {
    // Country code without '+', e.g. 96898115159.
    national = cleaned.slice(3);
  } else if (cleaned.length === 8) {
    // Bare national number (the natural Omani input). No country code present, so
    // this is not "reinterpreting a foreign number" — it is the app's only country.
    national = cleaned;
  } else {
    return { ok: false, reason: "INVALID_LENGTH" };
  }

  if (!NATIONAL_8.test(national)) return { ok: false, reason: "INVALID_LENGTH" };

  return { ok: true, e164: `+968${national}` };
}
