import { describe, it, expect } from "vitest";
import { toBookingDetailDTO, toBookingSummaryDTO, toProviderBookingDetailDTO } from "./dtos";
import type { RentalBookingSummary } from "@/lib/booking/rental-booking-summary";
import type { BookingMoneyView } from "@/lib/booking/pricing/booking-money-view";

// Phase 3C Slice C3/E2 — the customer + provider Booking API DTOs must carry the rental summary and
// present the party size as the rental passengerCount (never the billing-neutral seats=1), with the
// authoritative TOTALIZED total. Internal hold-group id / quote fingerprint are never exposed.
const rental: RentalBookingSummary = {
  offeringId: "off-1",
  vehicleId: "veh-1",
  vehicle: { make: "Toyota", model: "Hiace", modelYear: 2029, color: "white", vehicleType: "VAN", bookablePassengerCapacity: 6 },
  passengerCount: 4,
  chargeableDays: 2,
  dateKeys: ["2030-07-10", "2030-07-12"],
  perDate: [{ dateKey: "2030-07-10", amount: "40.00", currency: "OMR", source: "BASE" }, { dateKey: "2030-07-12", amount: "40.00", currency: "OMR", source: "BASE" }],
  total: "80.00",
  currency: "OMR",
  pricingUnit: "PER_VEHICLE_DAY",
};
const money: BookingMoneyView = { available: true, moneyMode: "TOTALIZED", total: "80.00", unitAmount: "80.00", currency: "OMR", pricingUnit: "PER_VEHICLE_DAY", billableQuantity: 1 };

describe("rental Booking API DTOs", () => {
  it("customer BookingDetailDTO carries the rental summary + passengerCount as seats + authoritative total", () => {
    // The read model already maps seats → passengerCount for a rental booking; the DTO passes it through.
    const detail = { id: "b1", status: "PENDING_PROVIDER", serviceId: "s1", serviceName: "Rental", providerId: "p1", providerName: "Prov", seats: 4, rental, bookingMoney: money, priceSnapshot: "80.00 OMR", slotStartTime: null, confirmedAt: null, createdAt: new Date("2030-07-01T00:00:00Z"), hasReview: false, paymentId: null, assignedVehicle: null, fulfillmentInstructions: null, serviceStartInstructions: null } as unknown as Parameters<typeof toBookingDetailDTO>[0];
    const dto = toBookingDetailDTO(detail, "en");
    expect(dto.seats).toBe(4); // NOT 1
    expect(dto.rental).toEqual(rental);
    expect(dto.bookingTotal).toEqual({ amount: "80.00", currency: "OMR" });
    expect(JSON.stringify(dto)).not.toMatch(/holdGroupId|quoteFingerprint/);
  });
  it("customer BookingSummaryDTO (list) carries the rental summary", () => {
    const item = { id: "b1", status: "CONFIRMED", serviceId: "s1", serviceName: "Rental", priceSnapshot: "80.00 OMR", bookingMoney: money, rental, availabilityId: null, slotStartTime: null, createdAt: new Date("2030-07-01T00:00:00Z") } as unknown as Parameters<typeof toBookingSummaryDTO>[0];
    const dto = toBookingSummaryDTO(item);
    expect(dto.rental).toEqual(rental);
    expect(dto.bookingTotal).toEqual({ amount: "80.00", currency: "OMR" });
  });
  it("provider BookingDetailDTO carries the rental summary + passengerCount as seats", () => {
    const detail = { id: "b1", serviceId: "s1", serviceName: "Rental", status: "PENDING_PROVIDER", seats: 4, rental, priceSnapshot: "80.00 OMR", bookingMoney: money, slotStartTime: null, createdAt: new Date("2030-07-01T00:00:00Z"), assignedVehicle: null, fulfillmentInstructions: null, fulfillmentInstructionsRaw: null, fulfillmentInstructionsEditable: false } as unknown as Parameters<typeof toProviderBookingDetailDTO>[0];
    const dto = toProviderBookingDetailDTO(detail, "en");
    expect(dto.seats).toBe(4);
    expect(dto.rental).toEqual(rental);
  });
  it("a non-rental booking carries rental: null and its own seats", () => {
    const detail = { id: "b2", status: "CONFIRMED", serviceId: "s1", serviceName: "Tour", providerId: "p1", providerName: "Prov", seats: 3, rental: null, bookingMoney: money, priceSnapshot: null, slotStartTime: null, confirmedAt: null, createdAt: new Date("2030-07-01T00:00:00Z"), hasReview: false, paymentId: null, assignedVehicle: null, fulfillmentInstructions: null, serviceStartInstructions: null } as unknown as Parameters<typeof toBookingDetailDTO>[0];
    const dto = toBookingDetailDTO(detail, "en");
    expect(dto.seats).toBe(3);
    expect(dto.rental).toBeNull();
  });
});
