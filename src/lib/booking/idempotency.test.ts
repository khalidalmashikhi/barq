import { describe, it, expect } from "vitest";
import { isValidIdempotencyKey, readIdempotencyKey, computeBookingRequestFingerprint } from "./idempotency";

// BOOKING-IDEMPOTENCY — the pure key/fingerprint contract.

describe("isValidIdempotencyKey", () => {
  it("accepts a UUID and other high-entropy safe tokens", () => {
    expect(isValidIdempotencyKey("018f2a3b-1c2d-7e3f-9a0b-1c2d3e4f5a6b")).toBe(true);
    expect(isValidIdempotencyKey("aB0._-9xYz")).toBe(true);
    expect(isValidIdempotencyKey("x".repeat(8))).toBe(true);
    expect(isValidIdempotencyKey("x".repeat(200))).toBe(true);
  });

  it("rejects too-short, too-long, and unsafe-charset values (§4)", () => {
    expect(isValidIdempotencyKey("short")).toBe(false); // < 8
    expect(isValidIdempotencyKey("x".repeat(201))).toBe(false); // > 200
    expect(isValidIdempotencyKey("has space")).toBe(false);
    expect(isValidIdempotencyKey("has/slash")).toBe(false);
    expect(isValidIdempotencyKey("emoji😀key")).toBe(false);
    expect(isValidIdempotencyKey("")).toBe(false);
    expect(isValidIdempotencyKey(123 as unknown)).toBe(false);
    expect(isValidIdempotencyKey(null)).toBe(false);
  });
});

describe("readIdempotencyKey", () => {
  it("null / empty → absent (booking proceeds without idempotency)", () => {
    expect(readIdempotencyKey(null)).toEqual({ state: "absent" });
    expect(readIdempotencyKey("")).toEqual({ state: "absent" });
  });

  it("malformed → invalid (fail closed, never silently ignored)", () => {
    expect(readIdempotencyKey("short")).toEqual({ state: "invalid" });
    expect(readIdempotencyKey("has space")).toEqual({ state: "invalid" });
    expect(readIdempotencyKey("x".repeat(201))).toEqual({ state: "invalid" });
  });

  it("a well-formed key → valid, verbatim (no trimming that could collide)", () => {
    expect(readIdempotencyKey("018f2a3b-1c2d-7e3f-9a0b-1c2d3e4f5a6b")).toEqual({
      state: "valid",
      key: "018f2a3b-1c2d-7e3f-9a0b-1c2d3e4f5a6b",
    });
  });
});

describe("computeBookingRequestFingerprint", () => {
  const base = { serviceId: "svc-1", priceId: "price-1", availabilityId: "av-1", seats: 2 };

  it("is deterministic for identical selectors (same request → replay)", () => {
    expect(computeBookingRequestFingerprint(base)).toBe(computeBookingRequestFingerprint({ ...base }));
  });

  it("changes when ANY booking selector changes (different request → conflict)", () => {
    const fp = computeBookingRequestFingerprint(base);
    expect(computeBookingRequestFingerprint({ ...base, serviceId: "svc-2" })).not.toBe(fp);
    expect(computeBookingRequestFingerprint({ ...base, priceId: "price-2" })).not.toBe(fp);
    expect(computeBookingRequestFingerprint({ ...base, availabilityId: "av-2" })).not.toBe(fp);
    expect(computeBookingRequestFingerprint({ ...base, seats: 3 })).not.toBe(fp);
  });

  it("distinguishes a slotless request (null availability) from a slot request, unambiguously", () => {
    const slotless = computeBookingRequestFingerprint({ ...base, availabilityId: null });
    const slotted = computeBookingRequestFingerprint({ ...base, availabilityId: "none" });
    // A literal 'none' slot id (pathological) must not collide with the real slotless marker.
    expect(slotless).not.toBe(slotted);
  });

  it("produces a SHA-256 hex digest (64 hex chars) — no PII, opaque", () => {
    expect(computeBookingRequestFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
