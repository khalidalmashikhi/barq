import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getEmailOtpConfig } = await import("./email-otp-config");
const {
  getEmailOtpSendIpRateLimit,
  getEmailOtpSendEmailRateLimit,
  getEmailOtpVerifyIpRateLimit,
  emailOtpSendIpKey,
  emailOtpSendEmailKey,
  emailOtpSendCooldownKey,
  emailOtpSendDailyKey,
  emailOtpVerifyIpKey,
} = await import("./email-otp-rate-limit-config");

afterEach(() => vi.unstubAllEnvs());

describe("getEmailOtpConfig", () => {
  it("uses Better-Auth-matching defaults when unset", () => {
    expect(getEmailOtpConfig()).toEqual({
      expiresInSeconds: 300,
      maxAttempts: 3,
      otpLength: 6,
      resendCooldownSeconds: 30,
      maxSendsPerDay: 10,
    });
  });

  it("reads overrides from env", () => {
    vi.stubEnv("EMAIL_OTP_EXPIRES_IN_SECONDS", "120");
    vi.stubEnv("EMAIL_OTP_MAX_ATTEMPTS", "5");
    vi.stubEnv("EMAIL_OTP_LENGTH", "8");
    vi.stubEnv("EMAIL_OTP_RESEND_COOLDOWN_SECONDS", "60");
    vi.stubEnv("EMAIL_OTP_MAX_SENDS_PER_DAY", "20");
    expect(getEmailOtpConfig()).toEqual({
      expiresInSeconds: 120,
      maxAttempts: 5,
      otpLength: 8,
      resendCooldownSeconds: 60,
      maxSendsPerDay: 20,
    });
  });

  it("fail-fasts on a malformed-but-set value (never silently falls back)", () => {
    vi.stubEnv("EMAIL_OTP_MAX_ATTEMPTS", "0");
    expect(() => getEmailOtpConfig()).toThrow(/EMAIL_OTP_MAX_ATTEMPTS/);
    vi.unstubAllEnvs();
    vi.stubEnv("EMAIL_OTP_EXPIRES_IN_SECONDS", "abc");
    expect(() => getEmailOtpConfig()).toThrow(/EMAIL_OTP_EXPIRES_IN_SECONDS/);
  });
});

describe("email OTP durable rate-limit config", () => {
  it("has generous defaults", () => {
    expect(getEmailOtpSendIpRateLimit()).toEqual({ limit: 15, windowSeconds: 3600 });
    expect(getEmailOtpSendEmailRateLimit()).toEqual({ limit: 6, windowSeconds: 3600 });
    expect(getEmailOtpVerifyIpRateLimit()).toEqual({ limit: 30, windowSeconds: 3600 });
  });

  it("keys are namespaced, distinct, and separate from the phone otp:* namespace", () => {
    expect(emailOtpSendIpKey("H")).toBe("emailotp:send:ip:H");
    expect(emailOtpSendEmailKey("H")).toBe("emailotp:send:email:H");
    expect(emailOtpSendCooldownKey("H")).toBe("emailotp:cooldown:email:H");
    expect(emailOtpSendDailyKey("H")).toBe("emailotp:daily:email:H");
    expect(emailOtpVerifyIpKey("H")).toBe("emailotp:verify:ip:H");
    const all = [
      emailOtpSendIpKey("H"),
      emailOtpSendEmailKey("H"),
      emailOtpSendCooldownKey("H"),
      emailOtpSendDailyKey("H"),
      emailOtpVerifyIpKey("H"),
    ];
    expect(new Set(all).size).toBe(all.length); // no collisions
    expect(all.every((k) => k.startsWith("emailotp:"))).toBe(true);
  });
});
