import { describe, it, expect, vi, afterEach } from "vitest";
import { ConsoleOtpProvider } from "./providers/console-provider";
import { DisabledOtpProvider } from "./providers/disabled-provider";
import { TwilioOtpProvider } from "./providers/twilio-provider";

// Phase D.4 — regression tests for the provider factory: confirms
// "switching providers requires configuration only" actually holds
// (OTP_PROVIDER alone selects the class), and that selecting twilio
// without its required credentials fails loudly rather than silently
// constructing a provider that will fail on first send().

vi.mock("server-only", () => ({}));

const { getOtpProvider } = await import("./get-otp-provider");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getOtpProvider", () => {
  it("returns ConsoleOtpProvider by default", () => {
    vi.stubEnv("OTP_PROVIDER", "");
    expect(getOtpProvider()).toBeInstanceOf(ConsoleOtpProvider);
  });

  it("returns TwilioOtpProvider when configured with full credentials", () => {
    vi.stubEnv("OTP_PROVIDER", "twilio");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+14155238886");

    expect(getOtpProvider()).toBeInstanceOf(TwilioOtpProvider);
  });

  it("returns DisabledOtpProvider when OTP_PROVIDER=disabled (staging-only mode)", () => {
    vi.stubEnv("OTP_PROVIDER", "disabled");
    expect(getOtpProvider()).toBeInstanceOf(DisabledOtpProvider);
  });

  it("throws when OTP_PROVIDER=twilio is missing credentials", () => {
    vi.stubEnv("OTP_PROVIDER", "twilio");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.stubEnv("TWILIO_FROM_NUMBER", "");

    expect(() => getOtpProvider()).toThrow(/TWILIO_ACCOUNT_SID/);
  });

  it("throws on an unrecognized OTP_PROVIDER value", () => {
    vi.stubEnv("OTP_PROVIDER", "nonexistent-vendor");
    expect(() => getOtpProvider()).toThrow(/unknown OTP_PROVIDER/);
  });

  it("throws on an invalid OTP_CHANNEL value", () => {
    vi.stubEnv("OTP_PROVIDER", "twilio");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    vi.stubEnv("TWILIO_FROM_NUMBER", "+14155238886");
    vi.stubEnv("OTP_CHANNEL", "carrier-pigeon");

    expect(() => getOtpProvider()).toThrow(/OTP_CHANNEL/);
  });
});
