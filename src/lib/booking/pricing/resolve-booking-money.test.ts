import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { resolveBookingMoney, resolveBookingChargeMoney, type BookingMoneyInput } from "./resolve-booking-money";

const base: BookingMoneyInput = {
  priceSnapshotAmount: null,
  priceSnapshotCurrency: null,
  pricingUnitSnapshot: null,
  billableQuantitySnapshot: null,
  bookingTotalSnapshot: null,
};

describe("resolveBookingMoney — LEGACY (no total snapshot)", () => {
  // THE CRITICAL INVARIANT: a legacy multi-seat booking must NOT be retroactively multiplied.
  it("unit=10, seats-equivalent context, total=NULL → effective total stays 10 (NEVER 50)", () => {
    const m = resolveBookingMoney({
      ...base,
      priceSnapshotAmount: "10",
      priceSnapshotCurrency: "OMR",
      // Note: no seats field is even consulted — totalized state is decided ONLY by the total.
      bookingTotalSnapshot: null,
    });
    expect(m.state).toBe("LEGACY");
    if (m.state !== "LEGACY") throw new Error("unreachable");
    expect(m.effectiveTotal.toFixed(2)).toBe("10.00");
    expect(m.effectiveTotal.toFixed(2)).not.toBe("50.00");
    expect(m.unitAmount.toFixed(2)).toBe("10.00");
    expect(m.currency).toBe("OMR");
  });

  it("never infers totalized from any non-total field", () => {
    // Even with a pricingUnit + quantity present, a NULL total is still LEGACY.
    const m = resolveBookingMoney({
      priceSnapshotAmount: "10",
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_PERSON",
      billableQuantitySnapshot: 5,
      bookingTotalSnapshot: null,
    });
    expect(m.state).toBe("LEGACY");
  });

  it("returns ABSENT when there is no money data at all", () => {
    expect(resolveBookingMoney(base)).toEqual({ state: "ABSENT" });
  });
});

describe("resolveBookingMoney — TOTALIZED (coherent snapshot)", () => {
  it("unit=10, PER_PERSON, quantity=5, total=50 → effective total 50", () => {
    const m = resolveBookingMoney({
      priceSnapshotAmount: "10",
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_PERSON",
      billableQuantitySnapshot: 5,
      bookingTotalSnapshot: "50",
    });
    expect(m.state).toBe("TOTALIZED");
    if (m.state !== "TOTALIZED") throw new Error("unreachable");
    expect(m.effectiveTotal.toFixed(2)).toBe("50.00");
    expect(m.unitAmount.toFixed(2)).toBe("10.00");
    expect(m.billableQuantity).toBe(5);
    expect(m.pricingUnit).toBe("PER_PERSON");
    expect(m.currency).toBe("OMR");
  });

  it("a fixed-unit totalized booking (PER_VEHICLE, quantity 1, total = unit) resolves cleanly", () => {
    const m = resolveBookingMoney({
      priceSnapshotAmount: "10",
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_VEHICLE",
      billableQuantitySnapshot: 1,
      bookingTotalSnapshot: "10",
    });
    expect(m.state).toBe("TOTALIZED");
  });

  it("accepts a Prisma.Decimal total and returns Decimal money", () => {
    const m = resolveBookingMoney({
      priceSnapshotAmount: new Prisma.Decimal("12.50"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_PERSON",
      billableQuantitySnapshot: 4,
      bookingTotalSnapshot: new Prisma.Decimal("50.00"),
    });
    if (m.state !== "TOTALIZED") throw new Error("expected TOTALIZED");
    expect(m.effectiveTotal).toBeInstanceOf(Prisma.Decimal);
    expect(m.effectiveTotal.toFixed(2)).toBe("50.00");
  });
});

describe("resolveBookingMoney — INVALID (total present but companions incoherent, fail closed)", () => {
  const good = {
    priceSnapshotAmount: "10",
    priceSnapshotCurrency: "OMR",
    pricingUnitSnapshot: "PER_PERSON",
    billableQuantitySnapshot: 5,
    bookingTotalSnapshot: "50",
  } satisfies BookingMoneyInput;

  it("does NOT silently fall back to the unit price when the snapshot is corrupt", () => {
    // Missing pricingUnitSnapshot on a totalized booking → INVALID, not 10 and not 50.
    const m = resolveBookingMoney({ ...good, pricingUnitSnapshot: null });
    expect(m.state).toBe("INVALID");
  });

  it.each([
    ["missing unit price", { priceSnapshotAmount: null }],
    ["invalid pricing unit", { pricingUnitSnapshot: "NONSENSE" }],
    ["missing billable quantity", { billableQuantitySnapshot: null }],
    ["non-positive billable quantity", { billableQuantitySnapshot: 0 }],
    ["fractional billable quantity", { billableQuantitySnapshot: 2.5 }],
    ["missing currency", { priceSnapshotCurrency: null }],
    ["negative total", { bookingTotalSnapshot: "-1" }],
  ] as const)("is INVALID when %s", (_label, override) => {
    const m = resolveBookingMoney({ ...good, ...(override as Partial<BookingMoneyInput>) });
    expect(m.state).toBe("INVALID");
  });
});

describe("resolveBookingChargeMoney (financial seam)", () => {
  it("LEGACY (total NULL) charges the historical unit — never × seats", () => {
    const r = resolveBookingChargeMoney({
      priceSnapshotAmount: "10",
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: null,
      billableQuantitySnapshot: null,
      bookingTotalSnapshot: null,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.money.total.toFixed(2)).toBe("10.00");
    expect(r.money.currency).toBe("OMR");
  });

  it("TOTALIZED charges the authoritative total", () => {
    const r = resolveBookingChargeMoney({
      priceSnapshotAmount: "10",
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_PERSON",
      billableQuantitySnapshot: 5,
      bookingTotalSnapshot: "50",
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.money.total.toFixed(2)).toBe("50.00");
  });

  it("FAILS CLOSED for INVALID (total present, companion corrupt) — never downgrades to unit", () => {
    const r = resolveBookingChargeMoney({
      priceSnapshotAmount: "10",
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: null, // corrupt: total but no unit code
      billableQuantitySnapshot: 5,
      bookingTotalSnapshot: "50",
    });
    expect(r.ok).toBe(false);
  });

  it("FAILS CLOSED for ABSENT (no money) and for a LEGACY row with no currency", () => {
    expect(resolveBookingChargeMoney(base).ok).toBe(false); // ABSENT
    expect(
      resolveBookingChargeMoney({ ...base, priceSnapshotAmount: "10", priceSnapshotCurrency: null }).ok
    ).toBe(false); // legacy without currency
  });
});
