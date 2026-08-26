// AUTH-INTERNATIONAL-PHONE-1 — the ONE authoritative international phone
// canonicalizer for BARQ authentication. It turns any accepted user input into a
// single canonical E.164 identity (e.g. `+96898115159`, `+447911123456`) using the
// maintained libphonenumber-js metadata, or rejects it. This SUPERSEDES the
// Oman-only `normalizeOmanPhone` (P0-1) as the wired auth authority: the server
// hook (server.ts), the "Add phone" flow (link-phone.ts), and the client resolver
// (phone-entry.ts) all funnel through here, so a number is validated/normalized by
// exactly ONE rule on every path — never one rule on login and another on linking.
//
// Backward compatibility: parsing with a default region of Oman means every legacy
// Oman form the P0-1 normalizer accepted still canonicalizes to the SAME
// `+968XXXXXXXX` — bare "98115159", "+96898115159", "96898115159", "0096898115159",
// and spaced/dashed variants — so existing Phone-OTP identities and the durable
// per-number rate-limit keys are unchanged. A full E.164 string (`+966…`, `+44…`)
// is self-describing and parses regardless of the default region.
//
// Pure/isomorphic (no I/O, no logging): it never emits the raw number. Validity is
// enforced with libphonenumber's `isValid()` so impossible / too-short / wrong-shape
// numbers are rejected rather than coerced. Canonicalization prevents formatting- or
// country-selection-based duplicates: equivalent inputs collapse to one E.164.

import { parsePhoneNumberFromString, isSupportedCountry, type CountryCode } from "libphonenumber-js";

export type NormalizeInternationalPhoneReason = "EMPTY" | "INVALID_COUNTRY" | "INVALID_NUMBER";

export type NormalizeInternationalPhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: NormalizeInternationalPhoneReason };

/** BARQ's default calling region for bare national input (Oman). */
export const DEFAULT_PHONE_REGION = "OM";

/**
 * Canonicalize a free-form phone `input` to E.164. `defaultCountry` (ISO alpha-2)
 * is the region assumed when the input carries no explicit country code — a full
 * E.164 / `00`-prefixed / with-country-code string overrides it. Rejects empty,
 * unparseable, and invalid/impossible numbers; never coerces an invalid number.
 */
export function normalizeInternationalPhone(
  input: string,
  defaultCountry: string = DEFAULT_PHONE_REGION
): NormalizeInternationalPhoneResult {
  if (typeof input !== "string") return { ok: false, reason: "EMPTY" };
  const raw = input.trim();
  if (raw === "") return { ok: false, reason: "EMPTY" };

  const region = defaultCountry.trim().toUpperCase();
  if (!isSupportedCountry(region)) return { ok: false, reason: "INVALID_COUNTRY" };

  let parsed;
  try {
    parsed = parsePhoneNumberFromString(raw, region as CountryCode);
  } catch {
    return { ok: false, reason: "INVALID_NUMBER" };
  }
  if (!parsed || !parsed.isValid()) return { ok: false, reason: "INVALID_NUMBER" };

  return { ok: true, e164: parsed.number };
}

/**
 * Canonicalize a (selected country ISO + national number) pair — the shape produced
 * by the country picker. The ISO is authoritative for a bare national number;
 * an unknown ISO is rejected as INVALID_COUNTRY (never guessed).
 */
export function normalizeInternationalPhoneParts(parts: {
  countryCode: string;
  nationalNumber: string;
}): NormalizeInternationalPhoneResult {
  const iso = (parts.countryCode ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso) || !isSupportedCountry(iso)) {
    return { ok: false, reason: "INVALID_COUNTRY" };
  }
  return normalizeInternationalPhone(parts.nationalNumber ?? "", iso);
}
