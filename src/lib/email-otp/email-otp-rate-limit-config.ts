import "server-only";

// Durable email-OTP rate-limit tuning — AUTH-CUSTOMER-EMAIL-OTP. Mirrors
// src/lib/otp/otp-rate-limit-config.ts. Every email-OTP anti-abuse control is
// enforced through the SAME durable, DB-backed limiter (consumeRateLimit over the
// auth_rate_limits table) the phone path uses, so it holds across serverless
// instances and fails closed. Unlike the phone path (which reads the Verification
// table for its cooldown/daily checks), the email path expresses cooldown + daily
// cap as durable-limiter windows too, so it never depends on the emailOTP plugin's
// internal verification-identifier format.
//
// Defaults are abuse deterrents, not UX quotas: a real person (or an office/NAT
// sharing one IP) must never be blocked, while scripted abuse from one source is
// capped.
//   - SEND cooldown:   at most 1 send per email per short window (paces resends).
//   - SEND daily:      total sends to one email over 24h (SMS/email-cost analogue).
//   - SEND per-IP:     total sends from one client IP across ALL emails.
//   - SEND per-email:  additional hourly ceiling on sends to one email.
//   - VERIFY per-IP:   verification attempts from one IP across ALL emails. There
//                      is intentionally NO per-email verify limiter (it would let
//                      an attacker lock a victim's address out); per-code brute
//                      force is already capped by Better Auth (allowedAttempts).

export interface DurableLimit {
  limit: number;
  windowSeconds: number;
}

function readPositiveInt(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envVar} must be a positive integer if set (got: "${raw}")`);
  }
  return parsed;
}

export function getEmailOtpSendIpRateLimit(): DurableLimit {
  return {
    limit: readPositiveInt("AUTH_EMAIL_OTP_SEND_IP_MAX", 15),
    windowSeconds: readPositiveInt("AUTH_EMAIL_OTP_SEND_IP_WINDOW_SECONDS", 3600),
  };
}

export function getEmailOtpSendEmailRateLimit(): DurableLimit {
  return {
    limit: readPositiveInt("AUTH_EMAIL_OTP_SEND_EMAIL_MAX", 6),
    windowSeconds: readPositiveInt("AUTH_EMAIL_OTP_SEND_EMAIL_WINDOW_SECONDS", 3600),
  };
}

export function getEmailOtpVerifyIpRateLimit(): DurableLimit {
  return {
    limit: readPositiveInt("AUTH_EMAIL_OTP_VERIFY_IP_MAX", 30),
    windowSeconds: readPositiveInt("AUTH_EMAIL_OTP_VERIFY_IP_WINDOW_SECONDS", 3600),
  };
}

// Namespaced, opaque (non-PII) durable-limiter keys. Every input is already an
// HMAC digest (hmacRateLimitKey) — of the client IP for the IP scopes, of the
// canonical lowercased email for the email scopes — so AuthRateLimit.key NEVER
// contains a raw IP or a raw email. Distinct prefixes (and a separate namespace
// from the phone `otp:*` keys) guarantee no cross-limiter collision.
export const emailOtpSendIpKey = (ipHmac: string): string => `emailotp:send:ip:${ipHmac}`;
export const emailOtpSendEmailKey = (emailHmac: string): string => `emailotp:send:email:${emailHmac}`;
export const emailOtpSendCooldownKey = (emailHmac: string): string => `emailotp:cooldown:email:${emailHmac}`;
export const emailOtpSendDailyKey = (emailHmac: string): string => `emailotp:daily:email:${emailHmac}`;
export const emailOtpVerifyIpKey = (ipHmac: string): string => `emailotp:verify:ip:${ipHmac}`;
