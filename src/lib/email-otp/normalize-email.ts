// Authoritative server-side email canonicalization — AUTH-CUSTOMER-EMAIL-OTP.
//
// The SINGLE source of truth that turns every accepted user input into ONE
// canonical email identity, wired into the Better Auth hooks.before for BOTH
// /email-otp/send-verification-otp and /sign-in/email-otp (src/lib/auth/server.ts)
// so the resend cooldown, the daily cap, the durable per-email limiter, the
// plugin's stored verification, and the resolved AuthUser identity ALL key on the
// same value — equivalent textual forms can neither multiply the per-email rate
// limits nor fragment identity.
//
// Pure function, no I/O, no logging (never emits the raw address). Mirrors
// normalize-oman-phone.ts's discriminated-result shape.
//
// Canonicalization is DELIBERATELY CONSERVATIVE (gate §6): trim surrounding
// whitespace + lowercase the whole address (Better Auth lowercases emails
// internally, so matching that here prevents a normalization mismatch between our
// rate-limit keys and the plugin's stored identifier). It performs NO
// provider-specific canonicalization (no Gmail dot/plus stripping) — those change
// identity semantics and are out of scope. Validation is a minimal structural
// check (exactly one "@", non-empty local part, a dotted multi-label domain, no
// whitespace), not full RFC 5322 — enough to reject obvious garbage before any
// code is generated, while never coercing a malformed address into a valid one.

export type NormalizeEmailResult =
  | { ok: true; email: string }
  | { ok: false; reason: "EMPTY" | "INVALID_FORMAT" };

// One "@", a non-empty local part with no whitespace/"@", and a domain of at
// least two dot-separated labels each 1+ chars (so "a@b" and "a@b." are rejected).
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const MAX_EMAIL_LENGTH = 254; // RFC 5321 practical ceiling; guards the rate-limit key + DB.

/** Canonicalize a user-entered email to a trimmed, lowercased address, or reject it. */
export function normalizeEmail(input: unknown): NormalizeEmailResult {
  if (typeof input !== "string") return { ok: false, reason: "EMPTY" };

  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, reason: "EMPTY" };

  const lowered = trimmed.toLowerCase();
  if (lowered.length > MAX_EMAIL_LENGTH) return { ok: false, reason: "INVALID_FORMAT" };
  if (!EMAIL_SHAPE.test(lowered)) return { ok: false, reason: "INVALID_FORMAT" };

  return { ok: true, email: lowered };
}
