import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { resolveBookingMoney, resolveBookingChargeMoney } from "./resolve-booking-money";
import { resolveBookingMoneyView, bookingMoneyRows } from "./booking-money-view";

// Phase 3C Slice C3/E2 — a rental Booking's money snapshot (TOTALIZED PER_VEHICLE_DAY, billableQuantity
// 1, unit == total) must resolve cleanly through the SAME seams every other booking uses, and must
// NEVER render a misleading unit×quantity breakdown (the total is a per-date SUM, not a multiplier).
const rentalSnapshot = {
  priceSnapshotAmount: new Prisma.Decimal("95.00"),
  priceSnapshotCurrency: "OMR",
  pricingUnitSnapshot: "PER_VEHICLE_DAY",
  billableQuantitySnapshot: 1,
  bookingTotalSnapshot: new Prisma.Decimal("95.00"),
};

describe("rental Booking money compatibility", () => {
  it("resolves as TOTALIZED with effectiveTotal = the authoritative total", () => {
    const money = resolveBookingMoney(rentalSnapshot);
    expect(money.state).toBe("TOTALIZED");
    if (money.state === "TOTALIZED") {
      expect(money.effectiveTotal.toFixed(2)).toBe("95.00");
      expect(money.pricingUnit).toBe("PER_VEHICLE_DAY");
      expect(money.billableQuantity).toBe(1);
    }
  });
  it("is chargeable at its authoritative total", () => {
    const charge = resolveBookingChargeMoney(rentalSnapshot);
    expect(charge.ok && charge.money.total.toFixed(2)).toBe("95.00");
    expect(charge.ok && charge.money.currency).toBe("OMR");
  });
  it("presents ONE total row — never a unit×quantity multiplication (billableQuantity 1)", () => {
    const view = resolveBookingMoneyView(rentalSnapshot);
    expect(view.available && view.moneyMode).toBe("TOTALIZED");
    const rows = bookingMoneyRows(view);
    expect(rows).toEqual([{ kind: "total", amount: "95.00", currency: "OMR", mode: "TOTALIZED", pricingUnit: "PER_VEHICLE_DAY" }]);
    // No "unit" or "quantity" row (which would imply a per-passenger/per-day multiplier that never happened).
    expect(rows!.some((r) => r.kind === "unit" || r.kind === "quantity")).toBe(false);
  });
});
