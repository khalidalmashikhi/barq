import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { validateOperationalInterval, isWellFormedIntervalPair } = await import("./operational-interval");

const A = new Date("2026-07-01T06:00:00.000Z");
const B = new Date("2026-07-01T10:00:00.000Z");

describe("validateOperationalInterval — BOOKING-INTERVAL-1", () => {
  it("both absent (null) → SCHEDULE_REQUIRED", () => {
    expect(validateOperationalInterval(null, null)).toEqual({ ok: false, error: "SCHEDULE_REQUIRED" });
    expect(validateOperationalInterval(undefined, undefined)).toEqual({ ok: false, error: "SCHEDULE_REQUIRED" });
  });

  it("one side missing → INVALID_SCHEDULE", () => {
    expect(validateOperationalInterval(A, null)).toEqual({ ok: false, error: "INVALID_SCHEDULE" });
    expect(validateOperationalInterval(null, B)).toEqual({ ok: false, error: "INVALID_SCHEDULE" });
  });

  it("non-date / NaN instant → INVALID_SCHEDULE", () => {
    expect(validateOperationalInterval(new Date("nonsense"), B)).toEqual({ ok: false, error: "INVALID_SCHEDULE" });
  });

  it("start == end → INVALID_SCHEDULE (half-open [start, end) requires start < end)", () => {
    expect(validateOperationalInterval(A, A)).toEqual({ ok: false, error: "INVALID_SCHEDULE" });
  });

  it("start > end → INVALID_SCHEDULE", () => {
    expect(validateOperationalInterval(B, A)).toEqual({ ok: false, error: "INVALID_SCHEDULE" });
  });

  it("start < end → ok with the interval (absolute instants preserved)", () => {
    expect(validateOperationalInterval(A, B)).toEqual({ ok: true, interval: { startsAt: A, endsAt: B } });
  });
});

describe("isWellFormedIntervalPair — stored-pair invariant", () => {
  it("both null → true (legacy/unset)", () => {
    expect(isWellFormedIntervalPair(null, null)).toBe(true);
  });
  it("one-sided → false", () => {
    expect(isWellFormedIntervalPair(A, null)).toBe(false);
    expect(isWellFormedIntervalPair(null, B)).toBe(false);
  });
  it("start < end → true; start >= end → false", () => {
    expect(isWellFormedIntervalPair(A, B)).toBe(true);
    expect(isWellFormedIntervalPair(A, A)).toBe(false);
    expect(isWellFormedIntervalPair(B, A)).toBe(false);
  });
});
