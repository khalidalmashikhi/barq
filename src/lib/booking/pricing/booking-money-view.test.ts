import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { resolveBookingMoneyView, bookingMoneyViewFromRow, formatBookingTotal, bookingMoneyRows } from "./booking-money-view";

// BOOKING TOTAL PRESENTATION — §27 read-model matrix. Proves the ONE shared presentation view
// tells the truth for every money state, and in particular that it NEVER manufactures a
// multiplication (legacy) and NEVER falls back to the unit price (invalid/absent).

describe("resolveBookingMoneyView", () => {
  it("LEGACY: unit 10, seats 5, no total snapshot → booking total 10 (never × seats), no billable multiplication", () => {
    const view = resolveBookingMoneyView({
      priceSnapshotAmount: new Prisma.Decimal("10"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: null,
      billableQuantitySnapshot: null,
      bookingTotalSnapshot: null,
    });
    expect(view).toEqual({
      available: true,
      moneyMode: "LEGACY",
      total: "10.00",
      unitAmount: "10.00",
      currency: "OMR",
      pricingUnit: null,
      billableQuantity: null,
    });
  });

  it("TOTALIZED PER_PERSON: unit 10 × 5 → total 50, carries the unit/basis/quantity breakdown", () => {
    const view = resolveBookingMoneyView({
      priceSnapshotAmount: new Prisma.Decimal("10"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_PERSON",
      billableQuantitySnapshot: 5,
      bookingTotalSnapshot: new Prisma.Decimal("50"),
    });
    expect(view).toEqual({
      available: true,
      moneyMode: "TOTALIZED",
      total: "50.00",
      unitAmount: "10.00",
      currency: "OMR",
      pricingUnit: "PER_PERSON",
      billableQuantity: 5,
    });
  });

  it("TOTALIZED PER_BOOKING: unit 10, guests 5, billableQuantity 1 → total 10 (no × 5)", () => {
    const view = resolveBookingMoneyView({
      priceSnapshotAmount: new Prisma.Decimal("10"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_BOOKING",
      billableQuantitySnapshot: 1,
      bookingTotalSnapshot: new Prisma.Decimal("10"),
    });
    expect(view).toMatchObject({ available: true, moneyMode: "TOTALIZED", total: "10.00", billableQuantity: 1, pricingUnit: "PER_BOOKING" });
  });

  it("TOTALIZED PER_TRIP: unit 25, guests 4, billableQuantity 1 → total 25 (never multiplied by passengers)", () => {
    const view = resolveBookingMoneyView({
      priceSnapshotAmount: new Prisma.Decimal("25"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_TRIP",
      billableQuantitySnapshot: 1,
      bookingTotalSnapshot: new Prisma.Decimal("25"),
    });
    expect(view).toMatchObject({ available: true, moneyMode: "TOTALIZED", total: "25.00", billableQuantity: 1, pricingUnit: "PER_TRIP" });
  });

  it("TOTALIZED PER_VEHICLE: unit 95, guests 4, billableQuantity 1 → total 95 (never 95 × 4)", () => {
    const view = resolveBookingMoneyView({
      priceSnapshotAmount: new Prisma.Decimal("95"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_VEHICLE",
      billableQuantitySnapshot: 1,
      bookingTotalSnapshot: new Prisma.Decimal("95"),
    });
    expect(view).toMatchObject({ available: true, moneyMode: "TOTALIZED", total: "95.00", billableQuantity: 1, pricingUnit: "PER_VEHICLE" });
  });

  it("INVALID (totalized but corrupt companion): available:false — NO false fallback to the unit price", () => {
    const view = resolveBookingMoneyView({
      priceSnapshotAmount: new Prisma.Decimal("10"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_PERSON",
      billableQuantitySnapshot: null, // corrupt: a total exists but no billable quantity
      bookingTotalSnapshot: new Prisma.Decimal("50"),
    });
    expect(view).toEqual({ available: false });
  });

  it("ABSENT (no money at all): available:false", () => {
    const view = resolveBookingMoneyView({
      priceSnapshotAmount: null,
      priceSnapshotCurrency: null,
      pricingUnitSnapshot: null,
      billableQuantitySnapshot: null,
      bookingTotalSnapshot: null,
    });
    expect(view).toEqual({ available: false });
  });

  it("LEGACY without a currency: available:false (an amount with no unit of account is un-presentable)", () => {
    const view = resolveBookingMoneyView({
      priceSnapshotAmount: new Prisma.Decimal("10"),
      priceSnapshotCurrency: null,
      pricingUnitSnapshot: null,
      billableQuantitySnapshot: null,
      bookingTotalSnapshot: null,
    });
    expect(view).toEqual({ available: false });
  });

  it("normalizes amounts to exactly 2 decimal places (Decimal.toFixed, never float)", () => {
    const view = resolveBookingMoneyView({
      priceSnapshotAmount: new Prisma.Decimal("7.5"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_PERSON",
      billableQuantitySnapshot: 2,
      bookingTotalSnapshot: new Prisma.Decimal("15"),
    });
    expect(view).toMatchObject({ available: true, unitAmount: "7.50", total: "15.00" });
  });
});

describe("formatBookingTotal", () => {
  it("returns the TOTAL (not the unit) for a totalized booking", () => {
    const s = formatBookingTotal({
      available: true, moneyMode: "TOTALIZED", total: "50.00", unitAmount: "10.00", currency: "OMR", pricingUnit: "PER_PERSON", billableQuantity: 5,
    });
    expect(s).toBe("50.00 OMR");
  });

  it("returns the historical amount for a legacy booking", () => {
    const s = formatBookingTotal({
      available: true, moneyMode: "LEGACY", total: "10.00", unitAmount: "10.00", currency: "OMR", pricingUnit: null, billableQuantity: null,
    });
    expect(s).toBe("10.00 OMR");
  });

  it("returns null (never the unit price) when the money is unavailable", () => {
    expect(formatBookingTotal({ available: false })).toBeNull();
  });
});

describe("bookingMoneyRows", () => {
  it("LEGACY → a single amount row, no unit/quantity fabricated", () => {
    const rows = bookingMoneyRows({
      available: true, moneyMode: "LEGACY", total: "10.00", unitAmount: "10.00", currency: "OMR", pricingUnit: null, billableQuantity: null,
    });
    expect(rows).toEqual([{ kind: "total", amount: "10.00", currency: "OMR", mode: "LEGACY", pricingUnit: null }]);
  });

  it("TOTALIZED PER_PERSON qty 5 → unit, quantity, then total (the real breakdown)", () => {
    const rows = bookingMoneyRows({
      available: true, moneyMode: "TOTALIZED", total: "50.00", unitAmount: "10.00", currency: "OMR", pricingUnit: "PER_PERSON", billableQuantity: 5,
    });
    expect(rows).toEqual([
      { kind: "unit", amount: "10.00", currency: "OMR", pricingUnit: "PER_PERSON" },
      { kind: "quantity", value: 5 },
      { kind: "total", amount: "50.00", currency: "OMR", mode: "TOTALIZED", pricingUnit: null },
    ]);
  });

  it("TOTALIZED PER_VEHICLE qty 1 → a single total row carrying the basis, NO quantity row", () => {
    const rows = bookingMoneyRows({
      available: true, moneyMode: "TOTALIZED", total: "95.00", unitAmount: "95.00", currency: "OMR", pricingUnit: "PER_VEHICLE", billableQuantity: 1,
    });
    expect(rows).toEqual([{ kind: "total", amount: "95.00", currency: "OMR", mode: "TOTALIZED", pricingUnit: "PER_VEHICLE" }]);
  });

  it("unavailable → null (the caller shows a safe 'unavailable' state)", () => {
    expect(bookingMoneyRows({ available: false })).toBeNull();
  });
});

describe("bookingMoneyViewFromRow", () => {
  it("maps a raw Booking row's five money snapshots straight through the resolver", () => {
    const view = bookingMoneyViewFromRow({
      priceSnapshotAmount: new Prisma.Decimal("10"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_PERSON",
      billableQuantitySnapshot: 3,
      bookingTotalSnapshot: new Prisma.Decimal("30"),
    });
    expect(view).toMatchObject({ available: true, moneyMode: "TOTALIZED", total: "30.00", unitAmount: "10.00", billableQuantity: 3 });
  });

  it("a legacy row (total snapshot null) yields the historical unit as the total", () => {
    const view = bookingMoneyViewFromRow({
      priceSnapshotAmount: new Prisma.Decimal("42"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: null,
      billableQuantitySnapshot: null,
      bookingTotalSnapshot: null,
    });
    expect(view).toMatchObject({ available: true, moneyMode: "LEGACY", total: "42.00" });
  });
});
