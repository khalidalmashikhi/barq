import "server-only";

// OTP tuning configuration — Phase D.4, extended Phase 5.1 (Production
// Readiness). Reads from environment variables with defaults matching
// Better Auth's own phoneNumber plugin defaults (expiresIn: 300s,
// allowedAttempts: 3), so leaving these unset changes nothing about
// existing behavior — only setting them changes it.
// OTP_RESEND_COOLDOWN_SECONDS and OTP_MAX_SENDS_PER_DAY have no Better
// Auth built-in equivalent (the plugin implements neither a resend
// cooldown nor a daily cap — confirmed by reading its route source),
// so their defaults are this project's own choice, not mirrored
// library defaults.

function readPositiveInt(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envVar} must be a positive integer if set (got: "${raw}")`);
  }
  return parsed;
}

export interface OtpConfig {
  expiresInSeconds: number;
  maxAttempts: number;
  resendCooldownSeconds: number;
  maxSendsPerDay: number;
}

export function getOtpConfig(): OtpConfig {
  return {
    expiresInSeconds: readPositiveInt("OTP_EXPIRES_IN_SECONDS", 300),
    maxAttempts: readPositiveInt("OTP_MAX_ATTEMPTS", 3),
    resendCooldownSeconds: readPositiveInt("OTP_RESEND_COOLDOWN_SECONDS", 30),
    maxSendsPerDay: readPositiveInt("OTP_MAX_SENDS_PER_DAY", 10),
  };
}
