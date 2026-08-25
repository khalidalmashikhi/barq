import { describe, it, expect, vi, afterEach } from "vitest";

// AUTH-CUSTOMER-EMAIL-OTP — mirrors src/lib/otp/audit.test.ts. Constructs real
// APIError instances (from the installed better-auth/api) with the same {code}
// shape the emailOTP plugin throws (verified against
// node_modules/better-auth/dist/plugins/email-otp/error-codes.mjs). Proves every
// log line carries a MASKED email, never the raw address, and never the OTP.

vi.mock("server-only", () => ({}));

const infoMock = vi.fn();
const warnMock = vi.fn();
const errorMock = vi.fn();

vi.mock("@/lib/logger", () => ({
  logger: {
    info: (...args: unknown[]) => infoMock(...args),
    warn: (...args: unknown[]) => warnMock(...args),
    error: (...args: unknown[]) => errorMock(...args),
  },
}));

const {
  classifyEmailVerifyOutcome,
  maskEmail,
  logEmailOtpRequested,
  logEmailOtpResendRejected,
  logEmailOtpDailyLimitRejected,
  logEmailOtpSent,
  logEmailOtpSendFailed,
  logEmailOtpVerifyOutcome,
} = await import("./audit");
const { APIError } = await import("better-auth/api");

afterEach(() => {
  infoMock.mockReset();
  warnMock.mockReset();
  errorMock.mockReset();
});

describe("classifyEmailVerifyOutcome", () => {
  it("classifies success (no error / token returned)", () => {
    expect(classifyEmailVerifyOutcome(undefined)).toBe("verified");
    expect(classifyEmailVerifyOutcome({ token: "t" })).toBe("verified");
  });
  it("classifies the three failure codes", () => {
    expect(classifyEmailVerifyOutcome(new APIError("BAD_REQUEST", { code: "OTP_EXPIRED", message: "x" }))).toBe("otp_expired");
    expect(classifyEmailVerifyOutcome(new APIError("FORBIDDEN", { code: "TOO_MANY_ATTEMPTS", message: "x" }))).toBe("too_many_attempts");
    expect(classifyEmailVerifyOutcome(new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "x" }))).toBe("invalid_otp");
  });
});

describe("maskEmail", () => {
  it("keeps the domain, masks the local part beyond the first char", () => {
    expect(maskEmail("alice@example.com")).toBe("a****@example.com");
    expect(maskEmail("bob@barq.om")).toBe("b**@barq.om");
  });
  it("fully masks a single-char local part", () => {
    expect(maskEmail("a@example.com")).toBe("*@example.com");
  });
  it("fully masks a string without a usable @", () => {
    expect(maskEmail("garbled")).toBe("*******");
    expect(maskEmail("@nolocal.com")).toBe("*".repeat("@nolocal.com".length));
  });
});

describe("email OTP log functions never log the raw email or any code", () => {
  const EMAIL = "customer@example.com";
  const MASKED = "c*******@example.com";

  it("requested / sent / resend-rejected / daily-rejected / send-failed use the masked email", () => {
    logEmailOtpRequested(EMAIL);
    expect(infoMock).toHaveBeenCalledWith("email_otp.requested", { email: MASKED });

    logEmailOtpSent(EMAIL);
    expect(infoMock).toHaveBeenCalledWith("email_otp.sent", { email: MASKED });

    logEmailOtpResendRejected(EMAIL, 30);
    expect(warnMock).toHaveBeenCalledWith("email_otp.resend_rejected", { email: MASKED, retryAfterSeconds: 30 });

    logEmailOtpDailyLimitRejected(EMAIL);
    expect(warnMock).toHaveBeenCalledWith("email_otp.daily_limit_rejected", { email: MASKED });

    logEmailOtpSendFailed(EMAIL, "provider down");
    expect(errorMock).toHaveBeenCalledWith("email_otp.send_failed", { email: MASKED, reason: "provider down" });

    // No call anywhere carried the raw address.
    const allArgs = JSON.stringify([...infoMock.mock.calls, ...warnMock.mock.calls, ...errorMock.mock.calls]);
    expect(allArgs).not.toContain(EMAIL);
  });

  it("verify outcome logs the right level + masked email", () => {
    logEmailOtpVerifyOutcome(EMAIL, undefined);
    expect(infoMock).toHaveBeenCalledWith("email_otp.verified", { email: MASKED });

    logEmailOtpVerifyOutcome(EMAIL, new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "x" }));
    expect(warnMock).toHaveBeenCalledWith("email_otp.invalid", { email: MASKED });
  });
});
