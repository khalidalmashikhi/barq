import "server-only";

// Email OTP tuning configuration — AUTH-CUSTOMER-EMAIL-OTP. Mirrors
// src/lib/otp/otp-config.ts (readPositiveInt: fail-fast on a malformed-but-set
// value rather than silently falling back). Defaults match Better Auth's emailOTP
// plugin defaults (expiresIn: 300s, allowedAttempts: 3), so leaving these unset
// changes nothing about the plugin's own behavior. resendCooldownSeconds and
// maxSendsPerDay have no Better Auth built-in equivalent (BARQ enforces them in
// the auth hooks via the durable limiter), so their defaults mirror the phone
// OTP choices (30s / 10 per day) for a consistent customer experience.

function readPositiveInt(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envVar} must be a positive integer if set (got: "${raw}")`);
  }
  return parsed;
}

export interface EmailOtpConfig {
  expiresInSeconds: number;
  maxAttempts: number;
  otpLength: number;
  resendCooldownSeconds: number;
  maxSendsPerDay: number;
}

export function getEmailOtpConfig(): EmailOtpConfig {
  return {
    expiresInSeconds: readPositiveInt("EMAIL_OTP_EXPIRES_IN_SECONDS", 300),
    maxAttempts: readPositiveInt("EMAIL_OTP_MAX_ATTEMPTS", 3),
    otpLength: readPositiveInt("EMAIL_OTP_LENGTH", 6),
    resendCooldownSeconds: readPositiveInt("EMAIL_OTP_RESEND_COOLDOWN_SECONDS", 30),
    maxSendsPerDay: readPositiveInt("EMAIL_OTP_MAX_SENDS_PER_DAY", 10),
  };
}
