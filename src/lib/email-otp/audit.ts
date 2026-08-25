import "server-only";
import { isAPIError } from "better-auth/api";
import { logger } from "@/lib/logger";

// Audit logging for email OTP authentication events — AUTH-CUSTOMER-EMAIL-OTP.
// Mirrors src/lib/otp/audit.ts: extracted so the outcome classification is
// unit-testable without a full Better Auth request context.
//
// Never logs the OTP code or any secret — only a MASKED email (see maskEmail) and,
// for send failures, the delivery provider's own error message. Email addresses
// are personal data; like phone numbers (SECURITY.md §5) they are masked at the
// log boundary, so the full address is still available to callers for real logic
// (rate-limit keying, delivery) but never reaches stdout.

export type EmailVerifyOutcome = "verified" | "otp_expired" | "too_many_attempts" | "invalid_otp";

// Better Auth's emailOTP plugin uses the SAME error codes as the phoneNumber
// plugin for the verify path (OTP_EXPIRED / TOO_MANY_ATTEMPTS / INVALID_OTP —
// verified against node_modules/better-auth/dist/plugins/email-otp/error-codes).
export function classifyEmailVerifyOutcome(returned: unknown): EmailVerifyOutcome {
  if (isAPIError(returned)) {
    const code = returned.body?.code;
    if (code === "OTP_EXPIRED") return "otp_expired";
    if (code === "TOO_MANY_ATTEMPTS") return "too_many_attempts";
    if (code === "INVALID_OTP") return "invalid_otp";
  }
  return "verified";
}

// Masks the local part and keeps the domain: "alice@example.com" -> "a***@example.com".
// A local part of 1 char is fully masked. Absent/garbled "@" masks the whole
// string. Keeping the domain is enough to correlate abuse investigations without
// exposing who the user is.
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "*".repeat(email.length);
  const local = email.slice(0, at);
  const domain = email.slice(at); // includes "@"
  const maskedLocal = local.length <= 1 ? "*" : local[0] + "*".repeat(local.length - 1);
  return maskedLocal + domain;
}

export function logEmailOtpRequested(email: string): void {
  logger.info("email_otp.requested", { email: maskEmail(email) });
}

export function logEmailOtpResendRejected(email: string, retryAfterSeconds: number): void {
  logger.warn("email_otp.resend_rejected", { email: maskEmail(email), retryAfterSeconds });
}

export function logEmailOtpDailyLimitRejected(email: string): void {
  logger.warn("email_otp.daily_limit_rejected", { email: maskEmail(email) });
}

export function logEmailOtpSent(email: string): void {
  logger.info("email_otp.sent", { email: maskEmail(email) });
}

export function logEmailOtpSendFailed(email: string, reason: string): void {
  logger.error("email_otp.send_failed", { email: maskEmail(email), reason });
}

export function logEmailOtpVerifyOutcome(email: string | undefined, returned: unknown): void {
  const outcome = classifyEmailVerifyOutcome(returned);
  const masked = email !== undefined ? maskEmail(email) : undefined;
  switch (outcome) {
    case "otp_expired":
      logger.warn("email_otp.expired", { email: masked });
      break;
    case "too_many_attempts":
      logger.warn("email_otp.too_many_attempts", { email: masked });
      break;
    case "invalid_otp":
      logger.warn("email_otp.invalid", { email: masked });
      break;
    case "verified":
      logger.info("email_otp.verified", { email: masked });
      break;
  }
}
