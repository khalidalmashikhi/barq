import "server-only";

// Durable auth/OTP rate-limit tuning — P1. Mirrors otp-config.ts / rate-limit-
// config.ts exactly (readPositiveInt: fail-fast on a malformed-but-set value
// rather than silently falling back). These are the NEW per-IP and per-phone
// durable limiters that complement — never replace — the existing per-phone 30s
// resend cooldown and daily send cap (src/lib/otp/check-*.ts), which stay.
//
// Defaults are deliberately generous abuse deterrents, not UX quotas: a real
// person (or a shared office/household NAT'd behind one IP) signing in must never
// be blocked, while mass scripted abuse from one source is capped.
//   - SEND per-IP:    total OTP sends from one client IP across ALL phones — the
//                     control the per-phone caps could not provide.
//   - SEND per-phone: an additional durable ceiling on sends to one canonical
//                     +968 number over the window (on top of cooldown + daily cap).
//   - VERIFY per-IP:  verification attempts from one IP across ALL phones. There
//                     is intentionally NO per-phone verify limiter here — that
//                     would let an attacker lock a victim's number out; per-code
//                     brute force is already capped by Better Auth (3 attempts).

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

export function getOtpSendIpRateLimit(): DurableLimit {
  return {
    limit: readPositiveInt("AUTH_OTP_SEND_IP_MAX", 15),
    windowSeconds: readPositiveInt("AUTH_OTP_SEND_IP_WINDOW_SECONDS", 3600),
  };
}

export function getOtpSendPhoneRateLimit(): DurableLimit {
  return {
    limit: readPositiveInt("AUTH_OTP_SEND_PHONE_MAX", 6),
    windowSeconds: readPositiveInt("AUTH_OTP_SEND_PHONE_WINDOW_SECONDS", 3600),
  };
}

export function getOtpVerifyIpRateLimit(): DurableLimit {
  return {
    limit: readPositiveInt("AUTH_OTP_VERIFY_IP_MAX", 30),
    windowSeconds: readPositiveInt("AUTH_OTP_VERIFY_IP_WINDOW_SECONDS", 3600),
  };
}

// Namespaced, opaque (non-PII) durable-limiter keys. Every input is already an
// HMAC digest (hmacRateLimitKey) — of the client IP for the IP scopes, of the
// canonical +968 phone for the send-phone scope — so AuthRateLimit.key NEVER
// contains a raw IP or a raw phone. The IP scopes are independent of the phone (one
// abusive IP is capped across ALL phones); the send-phone scope is independent of
// the IP (a number keeps its cap across IPs). Distinct prefixes guarantee no
// cross-limiter collision between send/verify or ip/phone scopes.
export const otpSendIpKey = (ipHmac: string): string => `otp:send:ip:${ipHmac}`;
export const otpSendPhoneKey = (phoneHmac: string): string => `otp:send:phone:${phoneHmac}`;
export const otpVerifyIpKey = (ipHmac: string): string => `otp:verify:ip:${ipHmac}`;
