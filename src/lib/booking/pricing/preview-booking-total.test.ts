import { describe, it, expect } from "vitest";
import { previewBookingTotal, normalizeDisplayAmount, amountToMinorUnits } from "./preview-booking-total";
import { calculateBookingTotal } from "./calculate-booking-total";
import { classifyBillability } from "@/lib/pricing-units/billability";

// CUSTOMER PRE-SUBMIT BOOKING TOTAL — the pure preview calculator (§24.1–5) and, crucially, a
// cross-check proving it AGREES with the authoritative calculateBookingTotal for every supported
// case. The preview takes the SERVER-classified billability token (never the raw pricing-unit
// code); these tests derive it via the shared classifyBillability so the mapping stays honest.

describe("previewBookingTotal", () => {
  it("QUANTITY_BASED (PER_PERSON) 10 × 5 = 50", () => {
    expect(previewBookingTotal({ unitAmount: "10", billability: "QUANTITY_BASED", quantity: 5 })).toEqual({ ok: true, billableQuantity: 5, total: "50.00" });
  });

  it("QUANTITY_BASED 10.25 × 3 = 30.75 (exact, no float artifact)", () => {
    expect(previewBookingTotal({ unitAmount: "10.25", billability: "QUANTITY_BASED", quantity: 3 })).toEqual({ ok: true, billableQuantity: 3, total: "30.75" });
  });

  it("FIXED (PER_BOOKING) 10, guests 5 → billable 1, total 10 (never × guests)", () => {
    expect(previewBookingTotal({ unitAmount: "10", billability: "FIXED", quantity: 5 })).toEqual({ ok: true, billableQuantity: 1, total: "10.00" });
  });

  it("FIXED (PER_TRIP) 25, guests 4 → total 25", () => {
    expect(previewBookingTotal({ unitAmount: "25", billability: "FIXED", quantity: 4 })).toEqual({ ok: true, billableQuantity: 1, total: "25.00" });
  });

  it("FIXED (PER_VEHICLE) 95, passengers 4 → total 95, NOT 380", () => {
    expect(previewBookingTotal({ unitAmount: "95", billability: "FIXED", quantity: 4 })).toEqual({ ok: true, billableQuantity: 1, total: "95.00" });
  });

  it("DURATION_BASED (PER_DAY/PER_HOUR) is not previewable (fail closed)", () => {
    expect(previewBookingTotal({ unitAmount: "10", billability: "DURATION_BASED_UNSUPPORTED", quantity: 2 })).toEqual({ ok: false, reason: "UNSUPPORTED_UNIT" });
  });

  it("an unknown/legacy (null billability) unit is not previewable", () => {
    expect(previewBookingTotal({ unitAmount: "10", billability: null, quantity: 1 })).toEqual({ ok: false, reason: "UNSUPPORTED_UNIT" });
  });

  it("a non-positive-integer quantity fails closed", () => {
    for (const q of [0, -1, 1.5, Number.NaN]) {
      expect(previewBookingTotal({ unitAmount: "10", billability: "QUANTITY_BASED", quantity: q })).toEqual({ ok: false, reason: "INVALID_QUANTITY" });
    }
  });

  it("a malformed unit amount fails closed", () => {
    expect(previewBookingTotal({ unitAmount: "abc", billability: "QUANTITY_BASED", quantity: 1 })).toEqual({ ok: false, reason: "INVALID_UNIT_AMOUNT" });
  });
});

describe("previewBookingTotal AGREES with the authoritative calculateBookingTotal (no divergence)", () => {
  const cases = [
    { unit: "10", pricingUnit: "PER_PERSON", qty: 5 },
    { unit: "10.25", pricingUnit: "PER_PERSON", qty: 3 },
    { unit: "7.5", pricingUnit: "PER_PERSON", qty: 2 },
    { unit: "10", pricingUnit: "PER_BOOKING", qty: 5 },
    { unit: "25", pricingUnit: "PER_TRIP", qty: 4 },
    { unit: "95", pricingUnit: "PER_VEHICLE", qty: 4 },
    { unit: "0", pricingUnit: "PER_PERSON", qty: 3 },
  ];
  it.each(cases)("$pricingUnit $unit × $qty matches the Decimal calculator", ({ unit, pricingUnit, qty }) => {
    // The client preview is fed the SERVER classification of the same code.
    const preview = previewBookingTotal({ unitAmount: unit, billability: classifyBillability(pricingUnit), quantity: qty });
    const authoritative = calculateBookingTotal({ unitAmount: unit, currency: "OMR", pricingUnit, bookingQuantity: qty });
    expect(preview.ok).toBe(true);
    expect(authoritative.ok).toBe(true);
    if (preview.ok && authoritative.ok) {
      expect(preview.total).toBe(authoritative.value.total.toFixed(2));
      expect(preview.billableQuantity).toBe(authoritative.value.billableQuantity);
    }
  });
});

describe("amount helpers", () => {
  it("normalizeDisplayAmount pads to 2dp without float", () => {
    expect(normalizeDisplayAmount("10")).toBe("10.00");
    expect(normalizeDisplayAmount("10.5")).toBe("10.50");
    expect(normalizeDisplayAmount("10.25")).toBe("10.25");
    expect(normalizeDisplayAmount("abc")).toBeNull();
    expect(normalizeDisplayAmount("-1")).toBeNull();
  });

  it("amountToMinorUnits is exact", () => {
    expect(amountToMinorUnits("10.25")).toBe(1025);
    expect(amountToMinorUnits("10")).toBe(1000);
    expect(amountToMinorUnits("0")).toBe(0);
  });
});
