import { describe, it, expect } from "vitest";
import { resolveBookingEstimate, type BookingEstimatePriceFacts } from "./booking-estimate-view";

// CUSTOMER PRE-SUBMIT BOOKING TOTAL — the pure view resolver behind the client island. All of the
// island's decision logic is here (the component is a thin DOM observer), so this is where the §24
// reactivity matrix is proven: price change, quantity change, invalid quantity, slotless, no-price.

const PER_PERSON: BookingEstimatePriceFacts = { id: "p1", amount: "10", currency: "OMR", billability: "QUANTITY_BASED", pricingUnitLabel: "per person" };
const PER_VEHICLE: BookingEstimatePriceFacts = { id: "p2", amount: "95", currency: "OMR", billability: "FIXED", pricingUnitLabel: "per vehicle" };
const PER_BOOKING: BookingEstimatePriceFacts = { id: "p3", amount: "10", currency: "OMR", billability: "FIXED", pricingUnitLabel: "per booking" };

describe("resolveBookingEstimate", () => {
  it("no price selected → no-price (never a total)", () => {
    expect(resolveBookingEstimate(null, "5")).toEqual({ state: "no-price" });
  });

  it("PER_PERSON 10 × 5 → ready, total 50, shows the multiplication", () => {
    expect(resolveBookingEstimate(PER_PERSON, "5")).toEqual({
      state: "ready", currency: "OMR", unitAmount: "10.00", quantity: 5, totalAmount: "50.00", basisLabel: "per person", showMultiplication: true,
    });
  });

  it("PER_PERSON qty 1 → ready, total 10, NO multiplication shown (× 1 is noise)", () => {
    expect(resolveBookingEstimate(PER_PERSON, "1")).toMatchObject({ state: "ready", totalAmount: "10.00", showMultiplication: false });
  });

  it("changing the quantity updates the PER_PERSON total", () => {
    expect(resolveBookingEstimate(PER_PERSON, "2")).toMatchObject({ state: "ready", totalAmount: "20.00" });
    expect(resolveBookingEstimate(PER_PERSON, "7")).toMatchObject({ state: "ready", totalAmount: "70.00" });
  });

  it("changing the price updates unit, basis, and total (never assumes prices[0])", () => {
    expect(resolveBookingEstimate(PER_PERSON, "4")).toMatchObject({ unitAmount: "10.00", totalAmount: "40.00", basisLabel: "per person" });
    expect(resolveBookingEstimate(PER_VEHICLE, "4")).toMatchObject({ unitAmount: "95.00", totalAmount: "95.00", basisLabel: "per vehicle", showMultiplication: false });
  });

  it("PER_VEHICLE with 4 passengers → 95, never 380, no multiplication row", () => {
    expect(resolveBookingEstimate(PER_VEHICLE, "4")).toMatchObject({ state: "ready", totalAmount: "95.00", showMultiplication: false });
  });

  it("PER_BOOKING with guests 5 → 10 (fixed), no multiplication", () => {
    expect(resolveBookingEstimate(PER_BOOKING, "5")).toMatchObject({ state: "ready", totalAmount: "10.00", showMultiplication: false });
  });

  it.each(["", " ", "0", "-1", "1.5", "abc"])("a present invalid quantity %j → invalid-quantity (no misleading total)", (bad) => {
    expect(resolveBookingEstimate(PER_PERSON, bad)).toEqual({ state: "invalid-quantity" });
  });

  it("slotless (no seats input → quantityRaw null) → quantity defaults to 1, ready", () => {
    // Mirrors the server contract: absent seats defaults to 1 (parseBookingQuantity).
    expect(resolveBookingEstimate(PER_PERSON, null)).toMatchObject({ state: "ready", quantity: 1, totalAmount: "10.00", showMultiplication: false });
  });

  it("a duration/legacy price is not previewable → unavailable (never a guessed total)", () => {
    expect(resolveBookingEstimate({ ...PER_PERSON, billability: "DURATION_BASED_UNSUPPORTED", pricingUnitLabel: "per day" }, "3")).toEqual({ state: "unavailable" });
    expect(resolveBookingEstimate({ ...PER_PERSON, billability: null, pricingUnitLabel: null }, "3")).toEqual({ state: "unavailable" });
  });
});
