import "server-only";
import { isAPIError } from "better-auth/api";
import { logger } from "@/lib/logger";

// Audit logging for OTP authentication events — Phase D.4. Extracted
// out of src/lib/auth/server.ts's inline hooks so the outcome
// classification (the part with actual branching logic) is unit
// -testable without constructing a full Better Auth request context.
//
// Never logs the OTP code or any secret — only a MASKED phone number
// (see maskPhoneNumber below) and, for send failures, the delivery
// provider's own error message.
//
// Production Blocker fix: every log line below previously logged the
// raw, unmasked phone number. Phone numbers are classified Confidential
// by this project's own locked SECURITY.md §5, which requires
// "Confidential/Restricted fields are masked in... any logging/
// observability output... without exception" — and OTP events are the
// highest-volume event type in the app (every sign-in touches this
// file), so this was the single largest source of unmasked PII in
// production logs. Masking happens once, at the log boundary, so the
// full number is still available to every caller for its own real
// logic (cooldown lookups, provider delivery) — only what actually
// reaches stdout is redacted.

export type VerifyOutcome = "verified" | "otp_expired" | "too_many_attempts" | "invalid_otp";

export function classifyVerifyOutcome(returned: unknown): VerifyOutcome {
  if (isAPIError(returned)) {
    const code = returned.body?.code;
    if (code === "OTP_EXPIRED") return "otp_expired";
    if (code === "TOO_MANY_ATTEMPTS") return "too_many_attempts";
    if (code === "INVALID_OTP") return "invalid_otp";
  }
  return "verified";
}

// Keeps only the last 4 characters — enough to correlate log lines
// about the same number during an investigation, without the full
// number ever landing in stdout. A number with 4 or fewer characters
// (never a real phone number, but a defensive floor regardless) is
// masked entirely rather than left unmasked.
export function maskPhoneNumber(phoneNumber: string): string {
  if (phoneNumber.length <= 4) return "*".repeat(phoneNumber.length);
  return "*".repeat(phoneNumber.length - 4) + phoneNumber.slice(-4);
}

export function logOtpRequested(phoneNumber: string): void {
  logger.info("otp.requested", { phoneNumber: maskPhoneNumber(phoneNumber) });
}

export function logResendRejected(phoneNumber: string, retryAfterSeconds: number): void {
  logger.warn("otp.resend_rejected", { phoneNumber: maskPhoneNumber(phoneNumber), retryAfterSeconds });
}

// Phase 5.1 (Production Readiness) — daily send-limit rejection,
// distinct from the 30s resend-cooldown rejection above: this fires
// only once a phone number has exhausted its daily cap, a much rarer
// and more suspicious event worth its own log line.
export function logDailyLimitRejected(phoneNumber: string, sentInWindow: number): void {
  logger.warn("otp.daily_limit_rejected", { phoneNumber: maskPhoneNumber(phoneNumber), sentInWindow });
}

export function logOtpSent(phoneNumber: string): void {
  logger.info("otp.sent", { phoneNumber: maskPhoneNumber(phoneNumber) });
}

export function logOtpSendFailed(phoneNumber: string, reason: string): void {
  logger.error("otp.send_failed", { phoneNumber: maskPhoneNumber(phoneNumber), reason });
}

export function logVerifyOutcome(phoneNumber: string | undefined, returned: unknown): void {
  const outcome = classifyVerifyOutcome(returned);
  const masked = phoneNumber !== undefined ? maskPhoneNumber(phoneNumber) : undefined;
  switch (outcome) {
    case "otp_expired":
      logger.warn("otp.expired", { phoneNumber: masked });
      break;
    case "too_many_attempts":
      logger.warn("otp.too_many_attempts", { phoneNumber: masked });
      break;
    case "invalid_otp":
      logger.warn("otp.invalid", { phoneNumber: masked });
      break;
    case "verified":
      logger.info("otp.verified", { phoneNumber: masked });
      break;
  }
}
