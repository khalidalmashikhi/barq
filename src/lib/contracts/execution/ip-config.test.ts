import { describe, it, expect, vi, afterEach } from "vitest";

// Phase E.3 — regression tests for the IP-logging config (requirement
// #3's "IP configurable/privacy-aware"): defaults to enabled, can be
// disabled via env var, and when disabled always resolves to null
// regardless of what the caller had available.

vi.mock("server-only", () => ({}));

const { isSignatureIpLoggingEnabled, resolveSignatureIp } = await import("./ip-config");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isSignatureIpLoggingEnabled", () => {
  it("defaults to true when unset", () => {
    vi.stubEnv("CONTRACT_SIGNATURE_LOG_IP", "");
    expect(isSignatureIpLoggingEnabled()).toBe(true);
  });

  it("is false when explicitly set to 'false'", () => {
    vi.stubEnv("CONTRACT_SIGNATURE_LOG_IP", "false");
    expect(isSignatureIpLoggingEnabled()).toBe(false);
  });

  it("is false when explicitly set to '0'", () => {
    vi.stubEnv("CONTRACT_SIGNATURE_LOG_IP", "0");
    expect(isSignatureIpLoggingEnabled()).toBe(false);
  });
});

describe("resolveSignatureIp", () => {
  it("returns the given IP when logging is enabled", () => {
    vi.stubEnv("CONTRACT_SIGNATURE_LOG_IP", "");
    expect(resolveSignatureIp("203.0.113.5")).toBe("203.0.113.5");
  });

  it("returns null when logging is disabled, regardless of the given IP", () => {
    vi.stubEnv("CONTRACT_SIGNATURE_LOG_IP", "false");
    expect(resolveSignatureIp("203.0.113.5")).toBeNull();
  });

  it("returns null when no IP was available, even with logging enabled", () => {
    vi.stubEnv("CONTRACT_SIGNATURE_LOG_IP", "");
    expect(resolveSignatureIp(undefined)).toBeNull();
  });
});
