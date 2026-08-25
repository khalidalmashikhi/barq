import { describe, it, expect } from "vitest";
import { buildBookingVehicleSnapshot } from "@/lib/booking/booking-vehicle-snapshot";
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
    }, "en");
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
        passengerCapacity: 6, vehicleType: "SUV", vehicleTypeLabel: "SUV", isFourByFour: false,
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
    }, "en");
    expect(dto.assignedVehicle).toBeNull();
  });

  // ASSIGNED-VEHICLE-TYPE-LABEL — the snapshot stores a canonical CODE; the label is
  // resolved at RESPONSE time. That split is what lets the same frozen booking be read in
  // either language without rewriting history.
  describe("assigned vehicle type label", () => {
    function detailWith(vehicleType: string | null) {
      return {
        id: "b1", serviceId: "s1", providerId: "p1", serviceName: "n", providerName: "pn",
        status: "CONFIRMED" as const, priceSnapshot: null, seats: 1, slotStartTime: null,
        confirmedAt: null, createdAt: new Date("2026-05-01T00:00:00.000Z"), hasReview: false,
        paymentId: null,
        assignedVehicle: {
          make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
          passengerCapacity: 6, vehicleType, isFourByFour: false,
        },
      };
    }

    function vehicleFor(locale: "en" | "ar", vehicleType: string | null = "SEDAN") {
      return toBookingDetailDTO(detailWith(vehicleType), locale).assignedVehicle!;
    }

    it("localizes a known type in English", () => {
      const v = vehicleFor("en");
      expect(v.vehicleType).toBe("SEDAN");
      expect(v.vehicleTypeLabel).toBe("Sedan");
    });

    it("localizes the same type in Arabic", () => {
      expect(vehicleFor("ar").vehicleTypeLabel).toBe("سيارة سيدان");
    });

    /** The CODE is the stable half: identical bytes in every language. */
    it("keeps the canonical code identical across locales", () => {
      expect(vehicleFor("en").vehicleType).toBe(vehicleFor("ar").vehicleType);
      expect(vehicleFor("en").vehicleTypeLabel).not.toBe(vehicleFor("ar").vehicleTypeLabel);
    });

    /**
     * A code frozen into an OLD booking that this build's registry no longer governs keeps
     * its historical value and resolves to NO label. Substituting the code would show a
     * customer `FOUR_BY_FOUR`.
     */
    it("returns a null label for an ungoverned code and never the code itself", () => {
      const v = vehicleFor("en", "HOVERCRAFT");
      expect(v.vehicleType).toBe("HOVERCRAFT");
      expect(v.vehicleTypeLabel).toBeNull();
    });

    it("returns a null label when the snapshot has no type", () => {
      const v = vehicleFor("en", null);
      expect(v.vehicleType).toBeNull();
      expect(v.vehicleTypeLabel).toBeNull();
    });

    it("never falls back to the raw code as the label", () => {
      for (const code of ["HOVERCRAFT", "SUBMARINE", "FOUR_BY_FOUR"]) {
        const v = vehicleFor("en", code);
        expect(v.vehicleTypeLabel).not.toBe(v.vehicleType);
      }
    });

    /**
     * TRUST IS UNTOUCHED. A booking whose snapshot says FOUR_BY_FOUR but whose trusted flag
     * is false stays unverified — the label is a category fact, never evidence.
     */
    it("leaves isFourByFour independent of the type and its label", () => {
      const v = vehicleFor("en", "FOUR_BY_FOUR");
      expect(v.vehicleTypeLabel).toBe("4x4");
      expect(v.isFourByFour).toBe(false);
    });


    /**
     * THE LABEL IS NEVER PERSISTED. `Booking.vehicleSnapshot` is immutable booking history,
     * and the same frozen booking may later be read in either language — so the stored
     * snapshot keeps the canonical code only, and localization happens at response time.
     *
     * Proven against the real builder, not a hand-written fixture: if a future change ever
     * wrote a label into the snapshot, this fails.
     */
    it("does not persist the localized label in the stored snapshot", () => {
      const snapshot = buildBookingVehicleSnapshot({
        make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
        passengerCapacity: 6, vehicleType: "SEDAN", fourByFourVerified: null,
      });

      expect(Object.keys(snapshot).sort()).toEqual([
        "color", "isFourByFour", "make", "model", "modelYear",
        "passengerCapacity", "vehicleType",
      ]);
      expect("vehicleTypeLabel" in snapshot).toBe(false);
    });

    /** Mapping is pure with respect to the snapshot: history is read, never rewritten. */
    it("does not mutate the snapshot it was given", () => {
      const snapshot = buildBookingVehicleSnapshot({
        make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
        passengerCapacity: 6, vehicleType: "SEDAN", fourByFourVerified: null,
      });
      const before = JSON.stringify(snapshot);

      toBookingDetailDTO({
        id: "b1", serviceId: "s1", providerId: "p1", serviceName: "n", providerName: "pn",
        status: "CONFIRMED", priceSnapshot: null, seats: 1, slotStartTime: null,
        confirmedAt: null, createdAt: new Date("2026-05-01T00:00:00.000Z"),
        hasReview: false, paymentId: null, assignedVehicle: snapshot,
      }, "ar");

      expect(JSON.stringify(snapshot)).toBe(before);
    });

    /** The customer allow-list is still exactly eight fields. */
    it("exposes exactly the eight customer fields", () => {
      expect(Object.keys(vehicleFor("en")).sort()).toEqual([
        "color", "isFourByFour", "make", "model", "modelYear",
        "passengerCapacity", "vehicleType", "vehicleTypeLabel",
      ]);
    });

    /** No plate, no ids — adding a derived label introduces no new data source. */
    it("still exposes no private field in either locale", () => {
      for (const locale of ["en", "ar"] as const) {
        const serialized = JSON.stringify(vehicleFor(locale));
        for (const forbidden of [
          "registrationNumber", "vehicleId", "assetId", "objectKey",
          "fourByFourVerified", "verificationStatus", "isInPool", "blockers",
        ]) {
          expect(serialized).not.toContain(forbidden);
        }
      }
    });
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
