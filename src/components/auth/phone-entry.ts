import { normalizeInternationalPhoneParts } from "@/lib/phone/normalize-international-phone";
import type { Country } from "@/lib/countries/registry";

// Phone-entry resolution — the ONE client-side place that turns (selected country +
// national input) into the exact E.164 phone identity handed to Better Auth's
// sendOtp/verify. Pure/isomorphic and unit-testable (this repo has no jsdom, so the
// security-relevant logic lives here, not in the .tsx component — same convention as
// otp-input.ts).
//
// INTERNATIONAL (AUTH-INTERNATIONAL-PHONE-1): it delegates to the shared authority
// normalizeInternationalPhoneParts (libphonenumber-js) — the SAME rule the server
// re-applies — so the value sent is the canonical E.164 the server re-normalizes as
// a no-op. For Oman this is byte-for-byte the legacy +968XXXXXXXX. The client-side
// resolve is UX only (gates the submit control); the server (P0-1/P1 hooks +
// link-phone) remains the authority and re-validates every number regardless.

export type ResolveAuthPhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: "COUNTRY_UNSUPPORTED" | "INVALID_NUMBER" };

export function resolveAuthPhone(country: Country, nationalInput: string): ResolveAuthPhoneResult {
  // Defensive: a country flagged unsupported can never produce a sendable number,
  // independent of the number's validity. (All curated countries are supported.)
  if (!country.authSupported) {
    return { ok: false, reason: "COUNTRY_UNSUPPORTED" };
  }

  const normalized = normalizeInternationalPhoneParts({ countryCode: country.iso, nationalNumber: nationalInput });
  if (normalized.ok) return { ok: true, e164: normalized.e164 };
  return { ok: false, reason: normalized.reason === "INVALID_COUNTRY" ? "COUNTRY_UNSUPPORTED" : "INVALID_NUMBER" };
}

/** Whether the current (country, input) can even request an OTP — gates the submit control. */
export function canRequestOtp(country: Country, nationalInput: string): boolean {
  return resolveAuthPhone(country, nationalInput).ok;
}
