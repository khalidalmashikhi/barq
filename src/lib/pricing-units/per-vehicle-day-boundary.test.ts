import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { isValidPricingUnit } from "./registry";
import { isBookablePricingUnit } from "./billability";
import { calculateBookingTotal } from "@/lib/booking/pricing/calculate-booking-total";
import { resolveBookingMoney } from "@/lib/booking/pricing/resolve-booking-money";

// Phase 3C Slice C2a — the PER_VEHICLE_DAY boundary: a VALID internal registry code that is
// NOT bookable through the legacy Price engine, leaving every PER_DAY rejection layer intact,
// while remaining a valid immutable-snapshot basis for a future C3 daily booking.

describe("PER_VEHICLE_DAY registry isolation", () => {
  it("is a VALID registry code but NOT bookable (so every legacy Price-write guard rejects it)", () => {
    expect(isValidPricingUnit("PER_VEHICLE_DAY")).toBe(true);
    // The single authority every create/update Price path validates against.
    expect(isBookablePricingUnit("PER_VEHICLE_DAY")).toBe(false);
  });

  it("PER_DAY remains unsupported/non-bookable (unchanged)", () => {
    expect(isBookablePricingUnit("PER_DAY")).toBe(false);
  });

  it("the LEGACY calculateBookingTotal does NOT accept PER_VEHICLE_DAY (fails closed, exactly like PER_DAY)", () => {
    const perVehicleDay = calculateBookingTotal({ unitAmount: "40.00", currency: "OMR", pricingUnit: "PER_VEHICLE_DAY", bookingQuantity: 3 });
    expect(perVehicleDay).toEqual({ ok: false, error: "UNSUPPORTED_BILLABLE_DURATION" });
    const perDay = calculateBookingTotal({ unitAmount: "40.00", currency: "OMR", pricingUnit: "PER_DAY", bookingQuantity: 3 });
    expect(perDay).toEqual({ ok: false, error: "UNSUPPORTED_BILLABLE_DURATION" });
  });

  it("existing bookable units keep identical behavior (PER_VEHICLE billed once, PER_PERSON × quantity)", () => {
    const perVehicle = calculateBookingTotal({ unitAmount: "40.00", currency: "OMR", pricingUnit: "PER_VEHICLE", bookingQuantity: 5 });
    expect(perVehicle.ok && perVehicle.value.total.toFixed(2)).toBe("40.00");
    const perPerson = calculateBookingTotal({ unitAmount: "10.00", currency: "OMR", pricingUnit: "PER_PERSON", bookingQuantity: 5 });
    expect(perPerson.ok && perPerson.value.total.toFixed(2)).toBe("50.00");
  });
});

describe("resolveBookingMoney legacy behavior is unchanged (validates by isValidPricingUnit)", () => {
  it("accepts a TOTALIZED snapshot whose basis is PER_VEHICLE_DAY (valid future C3 daily-booking basis)", () => {
    const money = resolveBookingMoney({
      priceSnapshotAmount: new Prisma.Decimal("40.00"),
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "PER_VEHICLE_DAY",
      billableQuantitySnapshot: 3,
      bookingTotalSnapshot: new Prisma.Decimal("120.00"),
    });
    expect(money.state).toBe("TOTALIZED");
    if (money.state === "TOTALIZED") {
      expect(money.effectiveTotal.toFixed(2)).toBe("120.00");
      expect(money.pricingUnit).toBe("PER_VEHICLE_DAY");
      expect(money.billableQuantity).toBe(3); // days, never passengers
    }
  });

  it("still fails closed on an ungoverned snapshot basis, and still resolves LEGACY/valid units unchanged", () => {
    const invalid = resolveBookingMoney({
      priceSnapshotAmount: "40.00",
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: "TOTALLY_FAKE",
      billableQuantitySnapshot: 1,
      bookingTotalSnapshot: "40.00",
    });
    expect(invalid.state).toBe("INVALID");

    const legacy = resolveBookingMoney({
      priceSnapshotAmount: "40.00",
      priceSnapshotCurrency: "OMR",
      pricingUnitSnapshot: null,
      billableQuantitySnapshot: null,
      bookingTotalSnapshot: null,
    });
    expect(legacy.state).toBe("LEGACY");
  });
});
