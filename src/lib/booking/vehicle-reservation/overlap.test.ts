import { describe, it, expect } from "vitest";
import { reservationIntervalsOverlap } from "./overlap";

const d = (iso: string) => new Date(iso);

describe("reservationIntervalsOverlap — half-open [start, end)", () => {
  it("identical windows overlap", () => {
    expect(reservationIntervalsOverlap(d("2026-06-01T09:00:00Z"), d("2026-06-01T12:00:00Z"), d("2026-06-01T09:00:00Z"), d("2026-06-01T12:00:00Z"))).toBe(true);
  });

  it("touching at a boundary does NOT overlap (a ends exactly when b starts)", () => {
    expect(reservationIntervalsOverlap(d("2026-06-01T09:00:00Z"), d("2026-06-01T12:00:00Z"), d("2026-06-01T12:00:00Z"), d("2026-06-01T15:00:00Z"))).toBe(false);
  });

  it("touching at a boundary does NOT overlap (b ends exactly when a starts)", () => {
    expect(reservationIntervalsOverlap(d("2026-06-01T12:00:00Z"), d("2026-06-01T15:00:00Z"), d("2026-06-01T09:00:00Z"), d("2026-06-01T12:00:00Z"))).toBe(false);
  });

  it("a 1ms sliver past the boundary DOES overlap", () => {
    expect(reservationIntervalsOverlap(d("2026-06-01T09:00:00Z"), d("2026-06-01T12:00:00.001Z"), d("2026-06-01T12:00:00Z"), d("2026-06-01T15:00:00Z"))).toBe(true);
  });

  it("fully disjoint windows do not overlap", () => {
    expect(reservationIntervalsOverlap(d("2026-06-01T09:00:00Z"), d("2026-06-01T10:00:00Z"), d("2026-06-01T14:00:00Z"), d("2026-06-01T15:00:00Z"))).toBe(false);
  });

  it("one window fully contained in the other overlaps (both orderings)", () => {
    expect(reservationIntervalsOverlap(d("2026-06-01T09:00:00Z"), d("2026-06-01T18:00:00Z"), d("2026-06-01T11:00:00Z"), d("2026-06-01T12:00:00Z"))).toBe(true);
    expect(reservationIntervalsOverlap(d("2026-06-01T11:00:00Z"), d("2026-06-01T12:00:00Z"), d("2026-06-01T09:00:00Z"), d("2026-06-01T18:00:00Z"))).toBe(true);
  });

  it("partial trailing overlap", () => {
    expect(reservationIntervalsOverlap(d("2026-06-01T09:00:00Z"), d("2026-06-01T12:00:00Z"), d("2026-06-01T11:00:00Z"), d("2026-06-01T14:00:00Z"))).toBe(true);
  });
});
