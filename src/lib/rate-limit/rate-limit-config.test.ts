import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const { getBookingCreateRateLimit, getReviewCreateRateLimit } = await import("./rate-limit-config");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBookingCreateRateLimit", () => {
  it("returns the documented defaults when unset", () => {
    expect(getBookingCreateRateLimit()).toEqual({ limit: 20, windowMs: 3_600_000 });
  });

  it("honors explicit env overrides", () => {
    vi.stubEnv("RATE_LIMIT_BOOKING_CREATE_MAX", "5");
    vi.stubEnv("RATE_LIMIT_BOOKING_CREATE_WINDOW_SECONDS", "60");
    expect(getBookingCreateRateLimit()).toEqual({ limit: 5, windowMs: 60_000 });
  });

  it("throws a clear error for a non-positive-integer override", () => {
    vi.stubEnv("RATE_LIMIT_BOOKING_CREATE_MAX", "not-a-number");
    expect(() => getBookingCreateRateLimit()).toThrow(/RATE_LIMIT_BOOKING_CREATE_MAX must be a positive integer/);
  });
});

describe("getReviewCreateRateLimit", () => {
  it("returns the documented defaults when unset", () => {
    expect(getReviewCreateRateLimit()).toEqual({ limit: 20, windowMs: 3_600_000 });
  });

  it("honors explicit env overrides", () => {
    vi.stubEnv("RATE_LIMIT_REVIEW_CREATE_MAX", "3");
    vi.stubEnv("RATE_LIMIT_REVIEW_CREATE_WINDOW_SECONDS", "120");
    expect(getReviewCreateRateLimit()).toEqual({ limit: 3, windowMs: 120_000 });
  });
});
