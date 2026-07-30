import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { checkOtpProviderHealth } = await import("./check-otp-provider-health");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkOtpProviderHealth", () => {
  it("returns \"console\" when OTP_PROVIDER is unset (the safe default)", () => {
    expect(checkOtpProviderHealth()).toBe("console");
  });

  it("returns \"misconfigured\" when OTP_PROVIDER=twilio is missing its required credentials", () => {
    vi.stubEnv("OTP_PROVIDER", "twilio");
    expect(checkOtpProviderHealth()).toBe("misconfigured");
  });

  it("returns \"twilio\" when OTP_PROVIDER=twilio has all required credentials", () => {
    vi.stubEnv("OTP_PROVIDER", "twilio");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token123");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+14155238886");
    expect(checkOtpProviderHealth()).toBe("twilio");
  });

  it("returns \"disabled\" when OTP_PROVIDER=disabled (staging-only mode, reported honestly, not as console)", () => {
    vi.stubEnv("OTP_PROVIDER", "disabled");
    expect(checkOtpProviderHealth()).toBe("disabled");
  });

  it("returns \"misconfigured\" for an unknown provider name", () => {
    vi.stubEnv("OTP_PROVIDER", "some-future-vendor");
    expect(checkOtpProviderHealth()).toBe("misconfigured");
  });
});
