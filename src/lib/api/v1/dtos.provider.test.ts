import { describe, it, expect } from "vitest";
import {
  toProviderWorkspaceStateDTO,
  toProviderProfileDTO,
  toProviderServiceListItemDTO,
  toProviderServiceDetailDTO,
  toProviderAvailabilitySlotDTO,
  toProviderBookingListItemDTO,
  toProviderBookingDetailDTO,
  toProviderVerificationDTO,
} from "./dtos";

describe("toProviderWorkspaceStateDTO", () => {
  it("exists:false for no provider", () => {
    expect(toProviderWorkspaceStateDTO(null)).toEqual({
      exists: false,
      id: null,
      status: null,
      type: null,
      visible: null,
      workspaceAvailable: false,
      verified: false,
    });
  });

  it("APPROVED provider → workspaceAvailable + verified true", () => {
    expect(
      toProviderWorkspaceStateDTO({ id: "p1", status: "APPROVED", providerType: "COMPANY", visible: true })
    ).toEqual({
      exists: true,
      id: "p1",
      status: "APPROVED",
      type: "COMPANY",
      visible: true,
      workspaceAvailable: true,
      verified: true,
    });
  });

  it("APPLIED provider → exists true, workspaceAvailable false; no leak of internal fields", () => {
    const dto = toProviderWorkspaceStateDTO({
      id: "p1",
      status: "APPLIED",
      providerType: "INDIVIDUAL",
      visible: false,
      // hostile extras that must be dropped:
      userId: "u1",
      approvedByAdminId: "a1",
    } as never);
    expect(dto.workspaceAvailable).toBe(false);
    expect(dto.verified).toBe(false);
    expect(JSON.stringify(dto)).not.toContain("userId");
    expect(JSON.stringify(dto)).not.toContain("approvedByAdminId");
  });
});

describe("toProviderProfileDTO", () => {
  it("maps self-profile (bilingual, contactEmail present); '' → null", () => {
    const dto = toProviderProfileDTO({
      id: "p1",
      businessNameAr: "شركة",
      businessNameEn: "Co",
      businessDescriptionAr: "",
      businessDescriptionEn: "desc",
      contactEmail: "biz@x.com",
      city: "",
      logoUrl: "",
      providerType: "COMPANY",
      status: "APPROVED",
    });
    expect(dto).toEqual({
      id: "p1",
      businessName: { ar: "شركة", en: "Co" },
      businessDescription: { ar: "", en: "desc" },
      providerType: "COMPANY",
      city: null,
      contactEmail: "biz@x.com",
      logoUrl: null,
    });
  });
});

describe("toProviderServiceListItemDTO / DetailDTO", () => {
  it("list item: money as string, ISO dates", () => {
    const dto = toProviderServiceListItemDTO({
      id: "s1",
      name: "Safari",
      status: "DRAFT",
      price: "25 OMR",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      hasNoUpcomingAvailability: true,
    });
    expect(dto.price).toEqual({ amount: "25.00", currency: "OMR" });
    expect(typeof dto.price!.amount).toBe("string");
    expect(dto.status).toBe("DRAFT");
    expect(dto.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("detail: builds MoneyDTO from priceAmount/priceCurrency", () => {
    const dto = toProviderServiceDetailDTO({
      id: "s1",
      name: "Safari",
      description: "d",
      status: "PUBLISHED",
      price: "25 OMR",
      priceAmount: "25",
      priceCurrency: "OMR",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(dto.price).toEqual({ amount: "25.00", currency: "OMR" });
  });
});

describe("toProviderAvailabilitySlotDTO", () => {
  it("exposes capacity + remainingSeats, NOT bookedCount", () => {
    const dto = toProviderAvailabilitySlotDTO({
      id: "a1",
      serviceId: "s1",
      serviceName: "Safari",
      startTime: new Date("2026-06-01T09:00:00.000Z"),
      endTime: new Date("2026-06-01T12:00:00.000Z"),
      state: "OPEN",
      capacity: 5,
      bookedCount: 2,
      remainingSeats: 3,
    });
    expect(dto).toEqual({
      id: "a1",
      serviceId: "s1",
      serviceName: "Safari",
      startTime: "2026-06-01T09:00:00.000Z",
      endTime: "2026-06-01T12:00:00.000Z",
      state: "OPEN",
      capacity: 5,
      remainingSeats: 3,
    });
    expect(Object.keys(dto)).not.toContain("bookedCount");
  });
});

describe("toProviderBookingListItemDTO / DetailDTO — no customer PII", () => {
  it("list item: money string, no customer fields", () => {
    const dto = toProviderBookingListItemDTO({
      id: "b1",
      serviceName: "Safari",
      status: "PENDING_PROVIDER",
      seats: 2,
      priceSnapshot: "25 OMR",
      bookingMoney: { available: true, moneyMode: "TOTALIZED", total: "50.00", unitAmount: "25.00", currency: "OMR", pricingUnit: "PER_PERSON", billableQuantity: 2 },
      slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
      availabilityId: "a1",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect(dto.priceSnapshot).toEqual({ amount: "25.00", currency: "OMR" }); // unit unchanged
    // BOOKING TOTAL PRESENTATION — the provider list carries the effective TOTAL (25 × 2), not the unit.
    expect(dto.bookingTotal).toEqual({ amount: "50.00", currency: "OMR" });
    expect(dto.moneyMode).toBe("TOTALIZED");
    expect(dto.billableQuantity).toBe(2);
    expect(dto.scheduledStartTime).toBe("2026-06-01T09:00:00.000Z");
    const s = JSON.stringify(dto);
    expect(s).not.toContain("customerId");
    expect(s).not.toContain("phone");
  });

  it("detail: serviceId present, no customer PII; assignedVehicle null when unassigned", () => {
    const dto = toProviderBookingDetailDTO({
      id: "b1",
      serviceId: "s1",
      serviceName: "Safari",
      status: "CONFIRMED",
      seats: 1,
      priceSnapshot: null,
      bookingMoney: { available: false },
      slotStartTime: null,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      assignedVehicle: null,
    }, "en");
    expect(dto.priceSnapshot).toBeNull();
    // Unavailable money → bookingTotal null, never the unit masquerading as the total.
    expect(dto.bookingTotal).toBeNull();
    expect(dto.moneyMode).toBeNull();
    expect(dto.scheduledStartTime).toBeNull();
    expect(dto.assignedVehicle).toBeNull();
    expect(JSON.stringify(dto)).not.toContain("customerId");
  });

  it("BOOKING-VEHICLE-2 — provider detail exposes snapshot fields + live plate, but no vehicleId/private data", () => {
    const dto = toProviderBookingDetailDTO({
      id: "b1", serviceId: "s1", serviceName: "Safari", status: "CONFIRMED", seats: 4,
      priceSnapshot: null, bookingMoney: { available: false }, slotStartTime: null, createdAt: new Date("2026-05-01T00:00:00.000Z"),
      assignedVehicle: {
        make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
        passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false, registrationNumber: "QA-TV2-0001",
      },
    }, "en");
    // EXACT equality, still exact: the provider variant is the customer allow-list PLUS the
    // one live plate, and nothing else. The localized label joins it; the plate survives.
    expect(dto.assignedVehicle).toEqual({
      make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
      passengerCapacity: 6, vehicleType: "SUV", vehicleTypeLabel: "SUV",
      isFourByFour: false, registrationNumber: "QA-TV2-0001",
    });
    const s = JSON.stringify(dto);
    // Plate is the ONLY live field; no ids or other private data ride along.
    for (const forbidden of ["vehicleId", "assetId", "claimedFourByFour", "fourByFourVerified", "verificationStatus", "objectKey", "documents"]) {
      expect(s).not.toContain(forbidden);
    }
  });
});

describe("toProviderVerificationDTO — localized, drops objectKey/versionToken", () => {
  it("localizes name/description; document exposes no objectKey/versionToken", () => {
    const dto = toProviderVerificationDTO(
      {
        providerType: "INDIVIDUAL",
        providerStatus: "APPLIED",
        storageAvailable: true,
        requiredTotal: 1,
        requiredApproved: 0,
        editable: false,
        canSubmit: false,
        submitBlockers: [],
        changesRequestedReason: null,
        items: [
          {
            type: "IDENTITY_PROOF",
            required: true,
            canUpload: false,
            name: { ar: "إثبات الهوية", en: "Identity Proof" },
            description: { ar: "وصف", en: "desc" },
            document: {
              id: "d1",
              status: "PENDING",
              originalFilename: "id.pdf",
              sizeBytes: 1000,
              rejectionReason: null,
              versionToken: "SECRET_TOKEN",
            },
          },
        ],
      },
      "en"
    );
    expect(dto.workspaceAvailable).toBe(false); // APPLIED
    expect(dto.canProgress).toBe(false); // 0/1 required approved
    expect(dto.items[0]!.name).toBe("Identity Proof");
    expect(dto.items[0]!.description).toBe("desc");
    expect(dto.items[0]!.document).toEqual({
      id: "d1",
      status: "PENDING",
      originalFilename: "id.pdf",
      sizeBytes: 1000,
      rejectionReason: null,
    });
    const s = JSON.stringify(dto);
    expect(s).not.toContain("versionToken");
    expect(s).not.toContain("SECRET_TOKEN");
    expect(s).not.toContain("objectKey");
  });

  it("canProgress true when all required approved; ar localization", () => {
    const dto = toProviderVerificationDTO(
      {
        providerType: "COMPANY",
        providerStatus: "APPROVED",
        storageAvailable: true,
        requiredTotal: 1,
        requiredApproved: 1,
        editable: false,
        canSubmit: false,
        submitBlockers: [],
        changesRequestedReason: null,
        items: [
          {
            type: "COMMERCIAL_REGISTRATION",
            required: true,
            canUpload: false,
            name: { ar: "السجل التجاري", en: "Commercial Registration" },
            description: null,
            document: {
              id: "d2",
              status: "APPROVED",
              originalFilename: "cr.pdf",
              sizeBytes: 2000,
              rejectionReason: null,
              versionToken: "T",
            },
          },
        ],
      },
      "ar"
    );
    expect(dto.canProgress).toBe(true);
    expect(dto.workspaceAvailable).toBe(true);
    expect(dto.items[0]!.name).toBe("السجل التجاري");
    expect(dto.items[0]!.description).toBeNull();
  });

  // ASSIGNED-VEHICLE-TYPE-LABEL — the provider surface inherits the localized label from the
  // shared customer-safe base, and keeps its own provider-only plate.
  describe("provider assigned vehicle type label", () => {
    function detail(vehicleType: string | null) {
      return {
        id: "b1", serviceId: "s1", serviceName: "Safari", status: "CONFIRMED" as const,
        seats: 4, priceSnapshot: null, bookingMoney: { available: false } as const, slotStartTime: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        assignedVehicle: {
          make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
          passengerCapacity: 6, vehicleType, isFourByFour: false,
          registrationNumber: "QA-TV2-0001",
        },
      };
    }

    function vehicleFor(locale: "en" | "ar", vehicleType: string | null = "SEDAN") {
      return toProviderBookingDetailDTO(detail(vehicleType), locale).assignedVehicle!;
    }

    it("localizes a known type in English", () => {
      const v = vehicleFor("en");
      expect(v.vehicleType).toBe("SEDAN");
      expect(v.vehicleTypeLabel).toBe("Sedan");
    });

    it("localizes the same type in Arabic", () => {
      expect(vehicleFor("ar").vehicleTypeLabel).toBe("سيارة سيدان");
    });

    /**
     * THE POINT OF MAKING locale REQUIRED. Before this gate a provider route could have
     * inherited a default locale and silently answered in the wrong language; now the code
     * is stable and the label genuinely follows the caller.
     */
    it("keeps the canonical code identical while the label follows the locale", () => {
      expect(vehicleFor("en").vehicleType).toBe(vehicleFor("ar").vehicleType);
      expect(vehicleFor("en").vehicleTypeLabel).not.toBe(vehicleFor("ar").vehicleTypeLabel);
    });

    it("returns a null label for an ungoverned code, never the code itself", () => {
      const v = vehicleFor("en", "HOVERCRAFT");
      expect(v.vehicleType).toBe("HOVERCRAFT");
      expect(v.vehicleTypeLabel).toBeNull();
    });

    /** The provider-only plate must survive the field-by-field localization. */
    it("preserves the provider-only plate in both locales", () => {
      expect(vehicleFor("en").registrationNumber).toBe("QA-TV2-0001");
      expect(vehicleFor("ar").registrationNumber).toBe("QA-TV2-0001");
    });

    it("exposes exactly the eight shared fields plus the plate", () => {
      expect(Object.keys(vehicleFor("en")).sort()).toEqual([
        "color", "isFourByFour", "make", "model", "modelYear", "passengerCapacity",
        "registrationNumber", "vehicleType", "vehicleTypeLabel",
      ]);
    });

    it("leaves isFourByFour independent of the type and its label", () => {
      const v = vehicleFor("en", "FOUR_BY_FOUR");
      expect(v.vehicleTypeLabel).toBe("4x4");
      expect(v.isFourByFour).toBe(false);
    });
  });
});
