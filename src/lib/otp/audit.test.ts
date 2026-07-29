import { describe, it, expect, vi, afterEach } from "vitest";

// Phase D.4 — regression tests for classifyVerifyOutcome, the core
// branching logic behind src/lib/auth/server.ts's `hooks.after`
// audit-logging middleware. Constructs real APIError instances (from
// the actual installed better-auth/api) with the same {code} shape
// Better Auth's own phoneNumber plugin throws (confirmed by reading
// node_modules/better-auth/dist/plugins/phone-number/routes.mjs),
// rather than a hand-rolled fake, so this test would break if that
// error shape ever changed upstream.
//
// Production Blocker fix — added maskPhoneNumber() coverage plus
// regression tests proving every log* function now logs the MASKED
// number, never the raw one, closing a real SECURITY.md §5 violation
// (Confidential data — phone numbers — must be masked in all logging
// output "without exception").

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
  classifyVerifyOutcome,
  maskPhoneNumber,
  logOtpRequested,
  logResendRejected,
  logDailyLimitRejected,
  logOtpSent,
  logOtpSendFailed,
  logVerifyOutcome,
} = await import("./audit");
const { APIError } = await import("better-auth/api");

describe("classifyVerifyOutcome", () => {
  it("classifies a successful verification (no error returned) as verified", () => {
    expect(classifyVerifyOutcome(undefined)).toBe("verified");
    expect(classifyVerifyOutcome({ token: "session-token" })).toBe("verified");
  });

  it("classifies OTP_EXPIRED", () => {
    const error = new APIError("BAD_REQUEST", { code: "OTP_EXPIRED", message: "OTP expired" });
    expect(classifyVerifyOutcome(error)).toBe("otp_expired");
  });

  it("classifies TOO_MANY_ATTEMPTS", () => {
    const error = new APIError("FORBIDDEN", { code: "TOO_MANY_ATTEMPTS", message: "Too many attempts" });
    expect(classifyVerifyOutcome(error)).toBe("too_many_attempts");
  });

  it("classifies INVALID_OTP (wrong code, not yet expired/exhausted)", () => {
    const error = new APIError("BAD_REQUEST", { code: "INVALID_OTP", message: "Invalid OTP" });
    expect(classifyVerifyOutcome(error)).toBe("invalid_otp");
  });

  it("classifies an unrelated APIError as verified (not this feature's concern)", () => {
    const error = new APIError("UNAUTHORIZED", { code: "SOME_OTHER_ERROR", message: "unrelated" });
    expect(classifyVerifyOutcome(error)).toBe("verified");
  });
});

describe("maskPhoneNumber", () => {
  it("keeps only the last 4 characters, masking the rest", () => {
    expect(maskPhoneNumber("+96812345678")).toBe("********5678");
  });

  it("masks a short value entirely rather than leaving it unmasked", () => {
    expect(maskPhoneNumber("123")).toBe("***");
    expect(maskPhoneNumber("1234")).toBe("****");
  });
});

describe("log* functions never log the raw phone number (Production Blocker fix)", () => {
  const RAW_PHONE = "+96812345678";
  const MASKED_PHONE = "********5678";

  afterEach(() => {
    infoMock.mockReset();
    warnMock.mockReset();
    errorMock.mockReset();
  });

  it("logOtpRequested logs only the masked number", () => {
    logOtpRequested(RAW_PHONE);
    expect(infoMock).toHaveBeenCalledWith("otp.requested", { phoneNumber: MASKED_PHONE });
    expect(JSON.stringify(infoMock.mock.calls)).not.toContain(RAW_PHONE);
  });

  it("logResendRejected logs only the masked number", () => {
    logResendRejected(RAW_PHONE, 15);
    expect(warnMock).toHaveBeenCalledWith("otp.resend_rejected", { phoneNumber: MASKED_PHONE, retryAfterSeconds: 15 });
  });

  it("logDailyLimitRejected logs only the masked number", () => {
    logDailyLimitRejected(RAW_PHONE, 10);
    expect(warnMock).toHaveBeenCalledWith("otp.daily_limit_rejected", { phoneNumber: MASKED_PHONE, sentInWindow: 10 });
  });

  it("logOtpSent logs only the masked number", () => {
    logOtpSent(RAW_PHONE);
    expect(infoMock).toHaveBeenCalledWith("otp.sent", { phoneNumber: MASKED_PHONE });
  });

  it("logOtpSendFailed logs only the masked number (and the provider's own error message, never a secret)", () => {
    logOtpSendFailed(RAW_PHONE, "delivery provider timeout");
    expect(errorMock).toHaveBeenCalledWith("otp.send_failed", {
      phoneNumber: MASKED_PHONE,
      reason: "delivery provider timeout",
    });
  });

  it("logVerifyOutcome logs only the masked number for every outcome branch", () => {
    logVerifyOutcome(RAW_PHONE, undefined);
    expect(infoMock).toHaveBeenCalledWith("otp.verified", { phoneNumber: MASKED_PHONE });

    const expiredError = new APIError("BAD_REQUEST", { code: "OTP_EXPIRED", message: "OTP expired" });
    logVerifyOutcome(RAW_PHONE, expiredError);
    expect(warnMock).toHaveBeenCalledWith("otp.expired", { phoneNumber: MASKED_PHONE });
  });

  it("logVerifyOutcome tolerates an undefined phoneNumber without throwing", () => {
    expect(() => logVerifyOutcome(undefined, undefined)).not.toThrow();
    expect(infoMock).toHaveBeenCalledWith("otp.verified", { phoneNumber: undefined });
  });
});
