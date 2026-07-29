import { describe, it, expect, vi, afterEach } from "vitest";

// Phase D.4 (Production OTP Integration) — regression tests for
// otp-config.ts's env-var parsing: defaults match Better Auth's own
// phoneNumber plugin defaults (expiresIn: 300s, allowedAttempts: 3)
// exactly, confirming that leaving these env vars unset changes
// nothing about existing behavior.
//
// vi.mock("server-only", ...) — otp-config.ts (like every file in
// src/lib/otp/) imports "server-only", which throws unconditionally
// outside Next's webpack build (see node_modules/server-only/index.js)
// — this stub is the standard way to unit-test a server-only module
// under Vitest's plain Node environment.

vi.mock("server-only", () => ({}));

const { getOtpConfig } = await import("./otp-config");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getOtpConfig", () => {
  it("defaults to Better Auth's own phoneNumber plugin defaults when unset", () => {
    vi.stubEnv("OTP_EXPIRES_IN_SECONDS", "");
    vi.stubEnv("OTP_MAX_ATTEMPTS", "");
    vi.stubEnv("OTP_RESEND_COOLDOWN_SECONDS", "");
    vi.stubEnv("OTP_MAX_SENDS_PER_DAY", "");

    const config = getOtpConfig();
    expect(config.expiresInSeconds).toBe(300);
    expect(config.maxAttempts).toBe(3);
    expect(config.resendCooldownSeconds).toBe(30);
    expect(config.maxSendsPerDay).toBe(10);
  });

  it("honors explicit env var overrides", () => {
    vi.stubEnv("OTP_EXPIRES_IN_SECONDS", "120");
    vi.stubEnv("OTP_MAX_ATTEMPTS", "5");
    vi.stubEnv("OTP_RESEND_COOLDOWN_SECONDS", "45");
    vi.stubEnv("OTP_MAX_SENDS_PER_DAY", "20");

    const config = getOtpConfig();
    expect(config.expiresInSeconds).toBe(120);
    expect(config.maxAttempts).toBe(5);
    expect(config.resendCooldownSeconds).toBe(45);
    expect(config.maxSendsPerDay).toBe(20);
  });

  it("throws on a non-positive-integer value instead of silently misconfiguring OTP lifetime", () => {
    vi.stubEnv("OTP_EXPIRES_IN_SECONDS", "-5");
    expect(() => getOtpConfig()).toThrow(/positive integer/);
  });
});
