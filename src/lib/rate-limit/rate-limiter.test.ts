import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRateLimit, _resetRateLimitStoreForTests } = await import("./rate-limiter");

afterEach(() => {
  _resetRateLimitStoreForTests();
});

describe("checkRateLimit", () => {
  it("allows the first request for a fresh key", () => {
    const result = checkRateLimit("k1", { limit: 3, windowMs: 60_000 }, 0);
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("allows up to the configured limit within the same window", () => {
    const config = { limit: 3, windowMs: 60_000 };
    expect(checkRateLimit("k2", config, 0).allowed).toBe(true);
    expect(checkRateLimit("k2", config, 1_000).allowed).toBe(true);
    expect(checkRateLimit("k2", config, 2_000).allowed).toBe(true);
  });

  it("rejects the request that exceeds the limit within the window", () => {
    const config = { limit: 2, windowMs: 60_000 };
    checkRateLimit("k3", config, 0);
    checkRateLimit("k3", config, 1_000);

    const result = checkRateLimit("k3", config, 2_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("reports a retryAfterSeconds bounded by the remaining window time", () => {
    const config = { limit: 1, windowMs: 60_000 };
    checkRateLimit("k4", config, 0);

    const result = checkRateLimit("k4", config, 55_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSeconds).toBe(5);
  });

  it("resets the count once the window has elapsed", () => {
    const config = { limit: 1, windowMs: 60_000 };
    checkRateLimit("k5", config, 0);
    expect(checkRateLimit("k5", config, 30_000).allowed).toBe(false);

    const result = checkRateLimit("k5", config, 60_000);
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("tracks separate keys independently", () => {
    const config = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit("customer-a", config, 0).allowed).toBe(true);
    expect(checkRateLimit("customer-b", config, 0).allowed).toBe(true);
    expect(checkRateLimit("customer-a", config, 0).allowed).toBe(false);
  });
});
