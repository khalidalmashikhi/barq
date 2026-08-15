import { normalizeOmanPhone } from "@/lib/otp/normalize-oman-phone";
import type { Country } from "@/lib/countries/registry";

// Phone-entry resolution — the ONE place that turns (selected country + national
// input) into the exact phone identity handed to Better Auth's sendOtp/verify.
// Pure/isomorphic and unit-testable (this repo has no jsdom, so the security-
// relevant logic lives here, not in the .tsx component — same convention as
// otp-input.ts).
//
// OMAN-ONLY, and it NEVER re-implements canonicalization: for the only currently
// auth-supported country (Oman) it delegates to the P0-1 normalizer
// (normalizeOmanPhone) — the single Oman identity authority — so the value sent is
// byte-for-byte the same canonical +968XXXXXXXX the server re-normalizes as a
// no-op. An unsupported country can NEVER produce a sendable number (the UI blocks
// send-otp before any request; the server also rejects non-Oman via P0-1).
//
// Enabling another country later is intentionally a paired change: set
// `authSupported: true` in registry.ts AND add its canonicalizer branch here (and
// the matching server-side canonicalization/OTP policy) — never one without the
// others.

export type ResolveAuthPhoneResult =
  | { ok: true; e164: string }
  | { ok: false; reason: "COUNTRY_UNSUPPORTED" | "INVALID_NUMBER" };

export function resolveAuthPhone(country: Country, nationalInput: string): ResolveAuthPhoneResult {
  if (!country.authSupported) {
    return { ok: false, reason: "COUNTRY_UNSUPPORTED" };
  }

  if (country.iso === "OM") {
    // Reuse P0-1 exactly. It already accepts "98115159", "+96898115159",
    // "96898115159", "0096898115159" (with spaces/dashes) and rejects everything
    // else — so the country selector never needs to duplicate that logic.
    const normalized = normalizeOmanPhone(nationalInput);
    return normalized.ok ? { ok: true, e164: normalized.e164 } : { ok: false, reason: "INVALID_NUMBER" };
  }

  // authSupported was flipped without wiring a canonicalizer — fail safe (never
  // silently coerce an unhandled country's number).
  return { ok: false, reason: "COUNTRY_UNSUPPORTED" };
}

/** Whether the current (country, input) can even request an OTP — gates the submit control. */
export function canRequestOtp(country: Country, nationalInput: string): boolean {
  return resolveAuthPhone(country, nationalInput).ok;
}
