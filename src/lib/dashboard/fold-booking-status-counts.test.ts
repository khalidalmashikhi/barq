import { describe, it, expect } from "vitest";
import { foldBookingStatusCounts } from "./fold-booking-status-counts";

// Customer Experience Platform — regression tests for the pure status-
// folding helper. Confirms: missing statuses are zero (never NaN/
// undefined), active reuses the existing CONFIRMED+IN_PROGRESS
// definition, cancelled combines CANCELLED+REJECTED (the documented,
// deliberate choice matching the Earnings phase's own precedent), and
// total sums every status including ones with no dedicated bucket
// (PENDING_PROVIDER, CREATED, DISPUTED, EXPIRED).

describe("foldBookingStatusCounts", () => {
  it("returns all-zero counts for a customer with zero bookings", () => {
    expect(foldBookingStatusCounts([])).toEqual({ total: 0, active: 0, completed: 0, cancelled: 0 });
  });

  it("treats a status with no rows as zero, not undefined", () => {
    const result = foldBookingStatusCounts([{ status: "COMPLETED", _count: 3 }]);
    expect(result).toEqual({ total: 3, active: 0, completed: 3, cancelled: 0 });
  });

  it("folds CONFIRMED and IN_PROGRESS into active, matching the existing activeBookingsCount definition", () => {
    const result = foldBookingStatusCounts([
      { status: "CONFIRMED", _count: 2 },
      { status: "IN_PROGRESS", _count: 1 },
    ]);
    expect(result.active).toBe(3);
    expect(result.total).toBe(3);
  });

  it("folds CANCELLED and REJECTED into cancelled (documented product rule, matches Earnings phase precedent)", () => {
    const result = foldBookingStatusCounts([
      { status: "CANCELLED", _count: 2 },
      { status: "REJECTED", _count: 4 },
    ]);
    expect(result.cancelled).toBe(6);
  });

  it("counts PENDING_PROVIDER, CREATED, DISPUTED, and EXPIRED toward total only, no dedicated bucket", () => {
    const result = foldBookingStatusCounts([
      { status: "PENDING_PROVIDER", _count: 1 },
      { status: "CREATED", _count: 1 },
      { status: "DISPUTED", _count: 1 },
      { status: "EXPIRED", _count: 1 },
    ]);
    expect(result).toEqual({ total: 4, active: 0, completed: 0, cancelled: 0 });
  });

  it("sums a full realistic mix correctly across every bucket", () => {
    const result = foldBookingStatusCounts([
      { status: "COMPLETED", _count: 5 },
      { status: "CONFIRMED", _count: 2 },
      { status: "IN_PROGRESS", _count: 1 },
      { status: "CANCELLED", _count: 1 },
      { status: "REJECTED", _count: 1 },
      { status: "PENDING_PROVIDER", _count: 1 },
    ]);
    expect(result).toEqual({ total: 11, active: 3, completed: 5, cancelled: 2 });
  });
});
