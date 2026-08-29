import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { calculateBookingTotal, type BookingTotalInput } from "./calculate-booking-total";

function ok(input: Partial<BookingTotalInput> & Pick<BookingTotalInput, "pricingUnit">) {
  const result = calculateBookingTotal({ unitAmount: "10", currency: "OMR", bookingQuantity: 1, ...input });
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
  return result.value;
}

describe("calculateBookingTotal — PER_PERSON (quantity-based)", () => {
  it("10 × 1 = 10", () => {
    const v = ok({ pricingUnit: "PER_PERSON", unitAmount: "10", bookingQuantity: 1 });
    expect(v.billableQuantity).toBe(1);
    expect(v.total.toFixed(2)).toBe("10.00");
    expect(v.subtotal.toFixed(2)).toBe("10.00"); // subtotal == total in V1
  });

  it("10 × 5 = 50", () => {
    const v = ok({ pricingUnit: "PER_PERSON", unitAmount: "10", bookingQuantity: 5 });
    expect(v.billableQuantity).toBe(5);
    expect(v.total.toFixed(2)).toBe("50.00");
  });

  it("Decimal 10.25 × 3 = 30.75 (no float artifact)", () => {
    const v = ok({ pricingUnit: "PER_PERSON", unitAmount: "10.25", bookingQuantity: 3 });
    expect(v.total.toFixed(2)).toBe("30.75");
    // Prove it is NOT the float path: 10.25 * 3 in JS is 30.75 here, but 0.1-style cases drift.
    const drift = ok({ pricingUnit: "PER_PERSON", unitAmount: "0.10", bookingQuantity: 3 });
    expect(drift.total.toFixed(2)).toBe("0.30"); // 0.1*3 === 0.30000000000000004 as a float
  });
});

describe("calculateBookingTotal — FIXED units (quantity never multiplies)", () => {
  it("PER_BOOKING: unit 10, customer quantity 5 → billable 1, total 10", () => {
    const v = ok({ pricingUnit: "PER_BOOKING", unitAmount: "10", bookingQuantity: 5 });
    expect(v.billableQuantity).toBe(1);
    expect(v.total.toFixed(2)).toBe("10.00");
  });

  it("PER_TRIP: same fixed semantics", () => {
    const v = ok({ pricingUnit: "PER_TRIP", unitAmount: "10", bookingQuantity: 5 });
    expect(v.billableQuantity).toBe(1);
    expect(v.total.toFixed(2)).toBe("10.00");
  });

  it("PER_VEHICLE: 4 passengers → billable 1, total = unit price (never × passengers)", () => {
    const v = ok({ pricingUnit: "PER_VEHICLE", unitAmount: "10", bookingQuantity: 4 });
    expect(v.billableQuantity).toBe(1);
    expect(v.total.toFixed(2)).toBe("10.00");
  });
});

describe("calculateBookingTotal — unsupported / unknown units (fail closed)", () => {
  it("PER_DAY → UNSUPPORTED_BILLABLE_DURATION", () => {
    expect(calculateBookingTotal({ unitAmount: "95", currency: "OMR", pricingUnit: "PER_DAY", bookingQuantity: 3 }))
      .toEqual({ ok: false, error: "UNSUPPORTED_BILLABLE_DURATION" });
  });

  it("PER_HOUR → UNSUPPORTED_BILLABLE_DURATION", () => {
    expect(calculateBookingTotal({ unitAmount: "20", currency: "OMR", pricingUnit: "PER_HOUR", bookingQuantity: 2 }))
      .toEqual({ ok: false, error: "UNSUPPORTED_BILLABLE_DURATION" });
  });

  it("an unknown unit → UNKNOWN_PRICING_UNIT (never defaulted to fixed)", () => {
    expect(calculateBookingTotal({ unitAmount: "10", currency: "OMR", pricingUnit: "PER_NIGHT", bookingQuantity: 1 }))
      .toEqual({ ok: false, error: "UNKNOWN_PRICING_UNIT" });
    expect(calculateBookingTotal({ unitAmount: "10", currency: "OMR", pricingUnit: "FLAT", bookingQuantity: 1 }))
      .toEqual({ ok: false, error: "UNKNOWN_PRICING_UNIT" });
  });
});

describe("calculateBookingTotal — quantity validation (fail closed)", () => {
  it.each([0, -1, -5])("rejects non-positive quantity %i", (q) => {
    expect(calculateBookingTotal({ unitAmount: "10", currency: "OMR", pricingUnit: "PER_PERSON", bookingQuantity: q }))
      .toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects non-integer quantity %s", (q) => {
    expect(calculateBookingTotal({ unitAmount: "10", currency: "OMR", pricingUnit: "PER_PERSON", bookingQuantity: q }))
      .toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });

  it("validates quantity even for FIXED units (a bad quantity is still structurally invalid)", () => {
    expect(calculateBookingTotal({ unitAmount: "10", currency: "OMR", pricingUnit: "PER_VEHICLE", bookingQuantity: 0 }))
      .toEqual({ ok: false, error: "INVALID_QUANTITY" });
  });
});

describe("calculateBookingTotal — unit amount validation", () => {
  it("rejects a negative unit amount", () => {
    expect(calculateBookingTotal({ unitAmount: "-1", currency: "OMR", pricingUnit: "PER_PERSON", bookingQuantity: 1 }))
      .toEqual({ ok: false, error: "INVALID_UNIT_AMOUNT" });
  });

  it("rejects a non-numeric unit amount", () => {
    expect(calculateBookingTotal({ unitAmount: "abc", currency: "OMR", pricingUnit: "PER_PERSON", bookingQuantity: 1 }))
      .toEqual({ ok: false, error: "INVALID_UNIT_AMOUNT" });
  });

  it("accepts a Prisma.Decimal unit amount and returns Decimal money", () => {
    const v = ok({ pricingUnit: "PER_PERSON", unitAmount: new Prisma.Decimal("12.50"), bookingQuantity: 4 });
    expect(v.total).toBeInstanceOf(Prisma.Decimal);
    expect(v.total.toFixed(2)).toBe("50.00");
  });

  it("passes currency through verbatim (no conversion)", () => {
    expect(ok({ pricingUnit: "PER_PERSON", currency: "OMR" }).currency).toBe("OMR");
  });
});
