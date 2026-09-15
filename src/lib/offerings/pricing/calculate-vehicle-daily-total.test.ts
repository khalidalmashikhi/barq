import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { calculateVehicleDailyTotal, type VehicleDailyRateInput } from "./calculate-vehicle-daily-total";

// Phase 3C Slice C2a — the isolated pure vehicle-day calculator. Passengers are never an
// input; the total is the exact Decimal sum of the supplied daily rates.

const day = (dateKey: string, amount: string, currency = "OMR"): VehicleDailyRateInput => ({
  dateKey,
  money: { amount, currency },
});

describe("calculateVehicleDailyTotal — success", () => {
  it("one day → total = that day's rate; chargeableDays 1; lowest = that rate", () => {
    const r = calculateVehicleDailyTotal([day("2026-08-20", "40.00")]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        dateKeys: ["2026-08-20"],
        chargeableDays: 1,
        currency: "OMR",
        total: "40.00",
        lowestDailyRate: "40.00",
      });
      expect(r.value.perDate).toEqual([{ dateKey: "2026-08-20", amount: "40.00", currency: "OMR" }]);
    }
  });

  it("several continuous days sum exactly (Decimal, no float artifact)", () => {
    const r = calculateVehicleDailyTotal([day("2026-08-20", "40.10"), day("2026-08-21", "40.20"), day("2026-08-22", "40.30")]);
    expect(r.ok && r.value.total).toBe("120.60");
    expect(r.ok && r.value.chargeableDays).toBe(3);
  });

  it("non-consecutive days: only the supplied dates are summed (gaps are not charged)", () => {
    const r = calculateVehicleDailyTotal([day("2026-08-20", "50.00"), day("2026-08-25", "50.00")]);
    // 2 chargeable days despite the 4-day gap between them.
    expect(r.ok && r.value.chargeableDays).toBe(2);
    expect(r.ok && r.value.total).toBe("100.00");
    expect(r.ok && r.value.dateKeys).toEqual(["2026-08-20", "2026-08-25"]);
  });

  it("sorts output chronologically regardless of input order", () => {
    const r = calculateVehicleDailyTotal([day("2026-08-25", "10.00"), day("2026-08-20", "10.00"), day("2026-08-22", "10.00")]);
    expect(r.ok && r.value.dateKeys).toEqual(["2026-08-20", "2026-08-22", "2026-08-25"]);
  });

  it("mixed override-like rates: total = exact sum, lowest = minimum", () => {
    const r = calculateVehicleDailyTotal([day("2026-08-20", "35.00"), day("2026-08-21", "60.00"), day("2026-08-22", "45.50")]);
    expect(r.ok && r.value.total).toBe("140.50");
    expect(r.ok && r.value.lowestDailyRate).toBe("35.00");
  });

  it("accepts a Prisma.Decimal amount and returns stable 2dp strings", () => {
    const r = calculateVehicleDailyTotal([{ dateKey: "2026-08-20", money: { amount: new Prisma.Decimal("40"), currency: "OMR" } }]);
    expect(r.ok && r.value.total).toBe("40.00");
    expect(r.ok && r.value.perDate[0]!.amount).toBe("40.00");
  });
});

describe("calculateVehicleDailyTotal — failures (explicit, never silently omit)", () => {
  it("EMPTY input", () => {
    expect(calculateVehicleDailyTotal([])).toEqual({ ok: false, reason: "EMPTY" });
  });

  it("DUPLICATE_DATE (no silent dedupe)", () => {
    expect(calculateVehicleDailyTotal([day("2026-08-20", "40.00"), day("2026-08-20", "50.00")])).toEqual({
      ok: false,
      reason: "DUPLICATE_DATE",
    });
  });

  it("INVALID_DATE_KEY (malformed + rollover)", () => {
    expect(calculateVehicleDailyTotal([day("2026-8-20", "40.00")]).ok).toBe(false);
    expect(calculateVehicleDailyTotal([day("2026-02-30", "40.00")])).toEqual({ ok: false, reason: "INVALID_DATE_KEY" });
    expect(calculateVehicleDailyTotal([day("not-a-date", "40.00")])).toEqual({ ok: false, reason: "INVALID_DATE_KEY" });
  });

  it("MIXED_CURRENCY (and empty currency)", () => {
    expect(calculateVehicleDailyTotal([day("2026-08-20", "40.00", "OMR"), day("2026-08-21", "40.00", "USD")])).toEqual({
      ok: false,
      reason: "MIXED_CURRENCY",
    });
    expect(calculateVehicleDailyTotal([day("2026-08-20", "40.00", "")])).toEqual({ ok: false, reason: "MIXED_CURRENCY" });
  });

  it("INVALID_RATE (zero, negative, non-finite, malformed, over-precision)", () => {
    for (const amt of ["0", "0.00", "-5.00", "abc", "40.123", "Infinity", "NaN"]) {
      expect(calculateVehicleDailyTotal([day("2026-08-20", amt)]).ok, amt).toBe(false);
      const r = calculateVehicleDailyTotal([day("2026-08-20", amt)]);
      expect(r.ok === false && r.reason).toBe("INVALID_RATE");
    }
  });

  it("has no passenger/seat multiplier field or behavior", () => {
    // The input type carries only dateKey + money; there is no seats/passengers field.
    const input = day("2026-08-20", "40.00") as Record<string, unknown>;
    expect("seats" in input).toBe(false);
    expect("passengers" in input).toBe(false);
    // Two identical single-day calls never differ by any party size (there is none).
    expect(calculateVehicleDailyTotal([day("2026-08-20", "40.00")])).toEqual(
      calculateVehicleDailyTotal([day("2026-08-20", "40.00")]),
    );
  });
});
