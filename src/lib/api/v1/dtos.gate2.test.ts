import { describe, it, expect } from "vitest";
import { toMeDTO, toBookingSummaryDTO, toBookingDetailDTO, toNotificationDTO } from "./dtos";

describe("toMeDTO", () => {
  it("maps identity + provider state; never leaks internal user fields", () => {
    const dto = toMeDTO(
      { id: "u1", name: "Sara", phoneNumber: "+96890000000", phoneNumberVerified: true },
      { exists: true, status: "APPROVED", type: "COMPANY", workspaceAvailable: true },
      "ar"
    );
    expect(dto).toEqual({
      id: "u1",
      name: "Sara",
      phone: "+96890000000",
      phoneVerified: true,
      locale: "ar",
      provider: { exists: true, status: "APPROVED", type: "COMPANY", workspaceAvailable: true },
    });
  });

  it("represents a customer with no Provider record", () => {
    const dto = toMeDTO(
      { id: "u1", name: null, phoneNumber: null, phoneNumberVerified: false },
      { exists: false, status: null, type: null, workspaceAvailable: false },
      "en"
    );
    expect(dto.provider).toEqual({ exists: false, status: null, type: null, workspaceAvailable: false });
    expect(dto.name).toBeNull();
    expect(dto.phone).toBeNull();
  });

  it("does not copy hostile/internal user fields (authUserId, status)", () => {
    const dto = toMeDTO(
      { id: "u1", name: "x", phoneNumber: "p", phoneNumberVerified: true, authUserId: "au1", status: "ACTIVE" } as never,
      { exists: false, status: null, type: null, workspaceAvailable: false },
      "en"
    );
    const keys = Object.keys(dto);
    expect(keys).not.toContain("authUserId");
    expect(keys).not.toContain("status");
    expect(JSON.stringify(dto)).not.toContain("au1");
  });
});

describe("toBookingSummaryDTO", () => {
  it("maps snapshot price to MoneyDTO string and dates to ISO", () => {
    const dto = toBookingSummaryDTO({
      id: "b1",
      serviceId: "svc-1",
      serviceName: "Desert Safari",
      status: "CONFIRMED",
      priceSnapshot: "25 OMR",
      availabilityId: "av-1",
      slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    // EXACT equality, deliberately kept exact: this assertion is the allow-list guard.
    // A Booking field that leaked into the DTO would fail here, which is the whole point
    // — it must never be relaxed to toMatchObject/objectContaining.
    expect(dto).toEqual({
      id: "b1",
      status: "CONFIRMED",
      serviceId: "svc-1",
      serviceName: "Desert Safari",
      priceSnapshot: { amount: "25.00", currency: "OMR" },
      scheduledStartTime: "2026-06-01T09:00:00.000Z",
      availabilityId: "av-1",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    expect(typeof dto.priceSnapshot!.amount).toBe("string");
  });

  it("maps null price / null slot", () => {
    const dto = toBookingSummaryDTO({
      id: "b1",
      serviceId: "svc-1",
      serviceName: "n",
      status: "CREATED",
      priceSnapshot: null,
      availabilityId: null,
      slotStartTime: null,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect(dto.priceSnapshot).toBeNull();
    expect(dto.scheduledStartTime).toBeNull();
    // NULL, never "" — a slotless booking has no slot, and an empty string would be a
    // value a client could accidentally match against.
    expect(dto.availabilityId).toBeNull();
  });

  // BOOKING-SUMMARY-RECONCILIATION — why these two ids are on the wire at all.
  describe("reconciliation key", () => {
    function summary(over: Partial<Parameters<typeof toBookingSummaryDTO>[0]> = {}) {
      return toBookingSummaryDTO({
        id: "b1",
        serviceId: "svc-1",
        serviceName: "Desert Safari",
        status: "PENDING_PROVIDER",
        priceSnapshot: null,
        availabilityId: "av-1",
        slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        ...over,
      });
    }

    /**
     * THE CLIENT PREDICATE, REPRODUCED. createBooking()'s duplicate guard is
     * `{ customerId, availabilityId, status: { not: "CANCELLED" } }`. customerId is
     * implicit (this endpoint only ever returns the caller's own bookings), so
     * availabilityId + status is exactly the client-visible remainder — which is why
     * both are exposed.
     */
    it("exposes availabilityId + status, the client-visible half of the server guard", () => {
      const candidates = [
        summary({ id: "match", availabilityId: "av-1", status: "PENDING_PROVIDER" }),
        summary({ id: "other-slot", availabilityId: "av-2" }),
        summary({ id: "cancelled", availabilityId: "av-1", status: "CANCELLED" }),
      ].filter((b) => b.availabilityId === "av-1" && b.status !== "CANCELLED");

      expect(candidates.map((c) => c.id)).toEqual(["match"]);
    });

    /**
     * AND WHY THE WEAKER KEY IS NOT ENOUGH. Availability has no
     * @@unique(serviceId, startTime), no unique/exclusion constraint in any migration,
     * and no overlap guard in any of the four availability write paths — so two rows may
     * legitimately share a service and a start time. Matching on those two fields
     * therefore yields two candidates, and a client would have to guess.
     */
    it("serviceId + scheduledStartTime alone cannot discriminate same-start slots", () => {
      const sameServiceSameStart = [
        summary({ id: "b1", availabilityId: "av-1" }),
        summary({ id: "b2", availabilityId: "av-2" }),
      ];

      const weak = sameServiceSameStart.filter(
        (b) => b.serviceId === "svc-1" && b.scheduledStartTime === "2026-06-01T09:00:00.000Z"
      );
      expect(weak).toHaveLength(2); // ambiguous — a client must not guess

      const strong = sameServiceSameStart.filter((b) => b.availabilityId === "av-1");
      expect(strong.map((b) => b.id)).toEqual(["b1"]); // unambiguous
    });

    /** serviceId is the defensive consistency check, never the discriminator. */
    it("carries serviceId as a stable machine id rather than a localized name", () => {
      const dto = summary({ serviceName: "\u0631\u062d\u0644\u0629" });

      expect(dto.serviceId).toBe("svc-1");
      expect(dto.serviceId).not.toBe(dto.serviceName);
    });
  });
});

describe("toBookingDetailDTO", () => {
  it("maps detail fields with MoneyDTO string and no internal leakage", () => {
    const dto = toBookingDetailDTO({
      id: "b1",
      serviceId: "s1",
      providerId: "p1",
      serviceName: "Safari",
      providerName: "Desert Co",
      status: "CONFIRMED",
      priceSnapshot: "25 OMR",
      seats: 3,
      slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
      confirmedAt: new Date("2026-05-02T00:00:00.000Z"),
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      hasReview: false,
      paymentId: "pay1",
      // BOOKING-VEHICLE-2 — customer-safe assigned-vehicle snapshot.
      assignedVehicle: {
        make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
        passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false,
      },
    });
    expect(dto).toEqual({
      id: "b1",
      status: "CONFIRMED",
      serviceId: "s1",
      serviceName: "Safari",
      providerId: "p1",
      providerName: "Desert Co",
      seats: 3,
      priceSnapshot: { amount: "25.00", currency: "OMR" },
      scheduledStartTime: "2026-06-01T09:00:00.000Z",
      confirmedAt: "2026-05-02T00:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
      hasReview: false,
      paymentId: "pay1",
      assignedVehicle: {
        make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
        passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false,
      },
    });
    // Customer never receives a plate or any id, even when a vehicle is assigned.
    const s = JSON.stringify(dto);
    for (const forbidden of ["registrationNumber", "vehicleId", "assetId", "fourByFourVerified", "verificationStatus"]) {
      expect(s).not.toContain(forbidden);
    }
  });

  it("assignedVehicle is null when the booking has no snapshot", () => {
    const dto = toBookingDetailDTO({
      id: "b1", serviceId: "s1", providerId: "p1", serviceName: "n", providerName: "pn",
      status: "PENDING_PROVIDER", priceSnapshot: null, seats: 1, slotStartTime: null,
      confirmedAt: null, createdAt: new Date("2026-05-01T00:00:00.000Z"), hasReview: false,
      paymentId: null, assignedVehicle: null,
    });
    expect(dto.assignedVehicle).toBeNull();
  });
});

describe("toNotificationDTO", () => {
  it("maps localized message + read state; kind undefined → null; never the raw payload", () => {
    const dto = toNotificationDTO({
      id: "n1",
      message: "Your booking is confirmed",
      isRead: false,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      causingBookingId: "b1",
      kind: undefined,
      eventType: null,
      entityType: null,
      entityId: null,
    });
    expect(dto).toEqual({
      id: "n1",
      message: "Your booking is confirmed",
      kind: null,
      isRead: false,
      causingBookingId: "b1",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
  });

  it("carries a present kind through and preserves read state", () => {
    const dto = toNotificationDTO({
      id: "n2",
      message: "m",
      isRead: true,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      causingBookingId: null,
      kind: "BOOKING_CONFIRMED",
      eventType: null,
      entityType: null,
      entityId: null,
    });
    expect(dto.kind).toBe("BOOKING_CONFIRMED");
    expect(dto.isRead).toBe(true);
    expect(dto.causingBookingId).toBeNull();
  });
});
