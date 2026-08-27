import { describe, it, expect } from "vitest";
// Static import: provider-mutation-errors has NO runtime server-only dependency
// (it imports the domain codes as `import type` only, plus apiError from ./errors),
// so no mocking is needed — this is a pure code→(status, wire-code) mapping test.
import {
  serviceErrorResponse,
  availabilityErrorResponse,
  providerProfileErrorResponse,
  providerBookingErrorResponse,
} from "./provider-mutation-errors";

async function read(res: Response) {
  const body = await res.json();
  return { status: res.status, code: body.error.code, details: body.error.details, store: res.headers.get("cache-control") };
}

describe("serviceErrorResponse", () => {
  it("maps every ServiceActionErrorCode to the right status + wire code", async () => {
    expect(await read(serviceErrorResponse("INVALID_INPUT", "en"))).toMatchObject({ status: 400, code: "INVALID_INPUT" });
    expect(await read(serviceErrorResponse("NO_PROVIDER_PROFILE", "en"))).toMatchObject({ status: 403, code: "NO_PROVIDER_PROFILE" });
    expect(await read(serviceErrorResponse("PROVIDER_NOT_APPROVED", "en"))).toMatchObject({ status: 403, code: "PROVIDER_NOT_APPROVED" });
    // Ownership → uniform 404 (anti-enumeration).
    expect(await read(serviceErrorResponse("SERVICE_NOT_FOUND", "en"))).toMatchObject({ status: 404, code: "NOT_FOUND" });
    // Both publish blockers collapse to "not publishable yet".
    expect(await read(serviceErrorResponse("NO_ACTIVE_PRICE", "en"))).toMatchObject({ status: 422, code: "SERVICE_NOT_PUBLISHABLE" });
    expect(await read(serviceErrorResponse("SERVICE_CATEGORY_REQUIRED", "en"))).toMatchObject({ status: 422, code: "SERVICE_NOT_PUBLISHABLE" });
    expect(await read(serviceErrorResponse("INVALID_CATEGORY", "en"))).toMatchObject({ status: 422, code: "INVALID_CATEGORY" });
    // Gate B5 — valid category but provider not authorized → distinct 403.
    expect(await read(serviceErrorResponse("ACTIVITY_NOT_AUTHORIZED", "en"))).toMatchObject({ status: 403, code: "ACTIVITY_NOT_AUTHORIZED" });
    // TOUR-1 — smart tour-guide template outcomes.
    expect(await read(serviceErrorResponse("TOUR_TEMPLATE_NOT_ELIGIBLE", "en"))).toMatchObject({ status: 422, code: "TOUR_TEMPLATE_NOT_ELIGIBLE" });
    expect(await read(serviceErrorResponse("TOUR_TEMPLATE_INVALID", "en"))).toMatchObject({ status: 422, code: "TOUR_TEMPLATE_INVALID" });
    // Publish-time completeness → reuses "not publishable yet".
    expect(await read(serviceErrorResponse("TOUR_TEMPLATE_REQUIRED", "en"))).toMatchObject({ status: 422, code: "SERVICE_NOT_PUBLISHABLE" });
    expect(await read(serviceErrorResponse("INVALID_STATUS_TRANSITION", "en"))).toMatchObject({ status: 409, code: "INVALID_STATUS_TRANSITION" });
    expect(await read(serviceErrorResponse("UNKNOWN_ERROR", "en"))).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });

  it("passes publish blockers through in details, and always sets no-store", async () => {
    const res = serviceErrorResponse("NO_ACTIVE_PRICE", "en", { blockers: ["NO_ACTIVE_PRICE", "SERVICE_CATEGORY_REQUIRED"] });
    const parsed = await read(res);
    expect(parsed.details).toEqual({ blockers: ["NO_ACTIVE_PRICE", "SERVICE_CATEGORY_REQUIRED"] });
    expect(parsed.store).toBe("no-store");
  });
});

describe("availabilityErrorResponse", () => {
  it("maps every AvailabilityActionErrorCode", async () => {
    expect(await read(availabilityErrorResponse("INVALID_INPUT", "en"))).toMatchObject({ status: 400, code: "INVALID_INPUT" });
    expect(await read(availabilityErrorResponse("NO_PROVIDER_PROFILE", "en"))).toMatchObject({ status: 403, code: "NO_PROVIDER_PROFILE" });
    expect(await read(availabilityErrorResponse("PROVIDER_NOT_APPROVED", "en"))).toMatchObject({ status: 403, code: "PROVIDER_NOT_APPROVED" });
    expect(await read(availabilityErrorResponse("SERVICE_NOT_FOUND", "en"))).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(await read(availabilityErrorResponse("SLOT_NOT_FOUND", "en"))).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(await read(availabilityErrorResponse("CAPACITY_BELOW_BOOKED", "en"))).toMatchObject({ status: 409, code: "CAPACITY_BELOW_BOOKED" });
    expect(await read(availabilityErrorResponse("SLOT_HAS_BOOKINGS", "en"))).toMatchObject({ status: 409, code: "SLOT_HAS_BOOKINGS" });
    expect(await read(availabilityErrorResponse("UNKNOWN_ERROR", "en"))).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});

describe("providerProfileErrorResponse", () => {
  it("maps every ProviderProfileActionErrorCode", async () => {
    expect(await read(providerProfileErrorResponse("INVALID_INPUT", "en"))).toMatchObject({ status: 400, code: "INVALID_INPUT" });
    expect(await read(providerProfileErrorResponse("NO_PROVIDER_PROFILE", "en"))).toMatchObject({ status: 403, code: "NO_PROVIDER_PROFILE" });
    expect(await read(providerProfileErrorResponse("UNKNOWN_ERROR", "en"))).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
  });
});

describe("providerBookingErrorResponse", () => {
  it("maps provider-context booking codes; lifecycle mismatches → 409 BOOKING_NOT_ACTIONABLE", async () => {
    expect(await read(providerBookingErrorResponse("INVALID_INPUT", "en"))).toMatchObject({ status: 400, code: "INVALID_INPUT" });
    expect(await read(providerBookingErrorResponse("NO_PROVIDER_PROFILE", "en"))).toMatchObject({ status: 403, code: "NO_PROVIDER_PROFILE" });
    // Ownership → uniform 404.
    expect(await read(providerBookingErrorResponse("BOOKING_NOT_FOUND", "en"))).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(await read(providerBookingErrorResponse("BOOKING_NOT_PENDING", "en"))).toMatchObject({ status: 409, code: "BOOKING_NOT_ACTIONABLE" });
    expect(await read(providerBookingErrorResponse("BOOKING_NOT_STARTABLE", "en"))).toMatchObject({ status: 409, code: "BOOKING_NOT_ACTIONABLE" });
    expect(await read(providerBookingErrorResponse("BOOKING_NOT_COMPLETABLE", "en"))).toMatchObject({ status: 409, code: "BOOKING_NOT_ACTIONABLE" });
    expect(await read(providerBookingErrorResponse("UNKNOWN_ERROR", "en"))).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    // A customer-only code that can't occur on these endpoints → unexpected internal.
    expect(await read(providerBookingErrorResponse("SLOT_FULL", "en"))).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    // PLATFORM-BOOKING-INCOMPLETE-ERROR-1 — same discipline. A provider accepting or
    // rejecting a booking is never gated on the CUSTOMER's credential completeness, so
    // this code is unreachable here, and a provider endpoint must not advertise a
    // customer-only rejection as though the provider could act on it.
    expect(await read(providerBookingErrorResponse("CUSTOMER_INCOMPLETE", "en"))).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    // BOOKING-VEHICLE-1 — acceptance vehicle-assignment outcomes (422), plus the concurrent race (409).
    expect(await read(providerBookingErrorResponse("VEHICLE_REQUIRED", "en"))).toMatchObject({ status: 422, code: "VEHICLE_REQUIRED" });
    expect(await read(providerBookingErrorResponse("VEHICLE_NOT_IN_SERVICE_POOL", "en"))).toMatchObject({ status: 422, code: "VEHICLE_NOT_IN_SERVICE_POOL" });
    expect(await read(providerBookingErrorResponse("VEHICLE_NOT_ELIGIBLE", "en"))).toMatchObject({ status: 422, code: "TOUR_VEHICLE_NOT_ELIGIBLE" });
    expect(await read(providerBookingErrorResponse("VEHICLE_CAPACITY_INSUFFICIENT", "en"))).toMatchObject({ status: 422, code: "VEHICLE_CAPACITY_INSUFFICIENT" });
    expect(await read(providerBookingErrorResponse("BOOKING_STATE_CONFLICT", "en"))).toMatchObject({ status: 409, code: "CONCURRENT_MODIFICATION" });
    // BOOKING-INTERVAL-1 — provider acceptance operational-schedule outcomes (422).
    expect(await read(providerBookingErrorResponse("SCHEDULE_REQUIRED", "en"))).toMatchObject({ status: 422, code: "SCHEDULE_REQUIRED" });
    expect(await read(providerBookingErrorResponse("INVALID_SCHEDULE", "en"))).toMatchObject({ status: 422, code: "INVALID_SCHEDULE" });
    // BOOKING-CONFLICT-1B — the selected vehicle is already committed to an overlapping
    // reservation → 409 Conflict, carried through as the stable VEHICLE_BUSY wire code.
    expect(await read(providerBookingErrorResponse("VEHICLE_BUSY", "en"))).toMatchObject({ status: 409, code: "VEHICLE_BUSY" });
  });

  it("BOOKING-CONFLICT-1B — VEHICLE_BUSY message is generic and leaks no conflicting-booking detail", async () => {
    const res = await read(providerBookingErrorResponse("VEHICLE_BUSY", "en"));
    expect(res.status).toBe(409);
    // The wire code is stable; the body carries no bookingId/customer/interval/reservation id.
    const body = JSON.stringify(res);
    for (const forbidden of ["bookingId", "customerId", "reservationId", "operationalStartAt"]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("always sets no-store", async () => {
    expect((await read(providerBookingErrorResponse("BOOKING_NOT_PENDING", "en"))).store).toBe("no-store");
  });
});
