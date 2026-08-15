import "server-only";
import { createHmac } from "node:crypto";

// Centralized trusted client-IP resolution + privacy-preserving keying — P1
// (durable auth/OTP rate limiting). ONE place resolves the IP and ONE primitive
// derives every rate-limit key, so the auth handlers never scatter header/crypto
// logic, and no raw IP or raw phone is ever stored or logged — only an HMAC is.
//
// TRUST MODEL (Vercel): the app is served behind Vercel's edge, which sets
// `x-real-ip` to the actual connecting client IP — a SINGLE value the client
// cannot forge. That is the ONLY source BARQ trusts. `x-forwarded-for` is
// deliberately NOT used: its leftmost token is client-spoofable (see Better
// Auth's own getIPFromHeader — "the leftmost token is spoofable… otherwise only a
// single-value header is trusted"), so trusting it would let an attacker rotate
// the value to evade the durable IP limiter. A missing/multi-valued `x-real-ip`
// collapses to one shared "unknown" bucket, which LIMITS rather than bypasses
// (fail-safe); on Vercel a missing client IP is not expected in normal operation.

const UNKNOWN_IP = "unknown";

/** Resolve the trusted client IP from Vercel's platform-set `x-real-ip` (or "unknown"). */
export function resolveClientIp(headers: Headers | null | undefined): string {
  if (!headers) return UNKNOWN_IP;

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const value = realIp.trim();
    // Require a single value: a comma means it is not the platform's single-valued
    // x-real-ip, so it is not trusted. (x-forwarded-for is never consulted.)
    if (value && !value.includes(",")) return value;
  }

  return UNKNOWN_IP;
}

// Derive a stable, one-way rate-limit key component from any identity value (a
// client IP, or a canonical +968 phone) using HMAC-SHA256 keyed with the EXISTING
// BETTER_AUTH_SECRET (no new secret invented). Same input → same key (so a source
// is limited consistently); the stored/logged value is a hex digest, never the raw
// value, and cannot be trivially reversed (unlike a plain hash of a small space)
// because it is HMAC-keyed with a server secret. The raw value is used only
// transiently here — it is never stored or logged.
export function hmacRateLimitKey(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}
