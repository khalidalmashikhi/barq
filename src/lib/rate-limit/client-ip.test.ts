import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { resolveClientIp, hmacRateLimitKey } from "./client-ip";

const H = (o: Record<string, string>) => new Headers(o);

describe("resolveClientIp — trusts ONLY Vercel's x-real-ip, never x-forwarded-for", () => {
  it("accepts a single-value x-real-ip", () => {
    expect(resolveClientIp(H({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("uses x-real-ip even when a (spoofable) x-forwarded-for is also present", () => {
    expect(resolveClientIp(H({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("203.0.113.7");
  });

  it("does NOT trust x-forwarded-for on its own — returns 'unknown'", () => {
    expect(resolveClientIp(H({ "x-forwarded-for": "203.0.113.9" }))).toBe("unknown");
  });

  it("does NOT trust a spoofed multi-value x-forwarded-for (no leftmost pick) — returns 'unknown'", () => {
    expect(resolveClientIp(H({ "x-forwarded-for": "1.2.3.4, 203.0.113.9, 10.0.0.1" }))).toBe("unknown");
  });

  it("a client rotating x-forwarded-for cannot change the resolved identity (always 'unknown' without x-real-ip)", () => {
    const a = resolveClientIp(H({ "x-forwarded-for": "1.1.1.1" }));
    const b = resolveClientIp(H({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }));
    expect(a).toBe("unknown");
    expect(b).toBe("unknown");
    expect(a).toBe(b);
  });

  it("rejects a multi-valued x-real-ip (not the platform's single value) — returns 'unknown'", () => {
    expect(resolveClientIp(H({ "x-real-ip": "203.0.113.7, 1.2.3.4" }))).toBe("unknown");
  });

  it("trims whitespace on x-real-ip", () => {
    expect(resolveClientIp(H({ "x-real-ip": "  203.0.113.12  " }))).toBe("203.0.113.12");
  });

  it("returns 'unknown' (LIMITS, never bypasses) when x-real-ip is missing or headers are absent", () => {
    expect(resolveClientIp(H({}))).toBe("unknown");
    expect(resolveClientIp(null)).toBe("unknown");
    expect(resolveClientIp(undefined)).toBe("unknown");
  });
});

describe("hmacRateLimitKey — privacy-preserving one-way keying (IP or phone)", () => {
  it("is deterministic: same value + secret → same key", () => {
    expect(hmacRateLimitKey("203.0.113.7", "secret")).toBe(hmacRateLimitKey("203.0.113.7", "secret"));
    expect(hmacRateLimitKey("+96898115159", "secret")).toBe(hmacRateLimitKey("+96898115159", "secret"));
  });

  it("differs by value", () => {
    expect(hmacRateLimitKey("203.0.113.7", "secret")).not.toBe(hmacRateLimitKey("203.0.113.8", "secret"));
    expect(hmacRateLimitKey("+96898115159", "secret")).not.toBe(hmacRateLimitKey("+96871234567", "secret"));
  });

  it("differs by secret (HMAC-keyed, not a plain reversible hash)", () => {
    expect(hmacRateLimitKey("+96898115159", "s1")).not.toBe(hmacRateLimitKey("+96898115159", "s2"));
  });

  it("never contains the raw value; is a 64-hex SHA-256 digest", () => {
    const ipKey = hmacRateLimitKey("203.0.113.7", "secret");
    const phoneKey = hmacRateLimitKey("+96898115159", "secret");
    expect(ipKey).not.toContain("203.0.113.7");
    expect(phoneKey).not.toContain("96898115159");
    expect(ipKey).toMatch(/^[a-f0-9]{64}$/);
    expect(phoneKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not throw on an empty secret (safe dev fallback)", () => {
    expect(() => hmacRateLimitKey("203.0.113.7", "")).not.toThrow();
  });
});
