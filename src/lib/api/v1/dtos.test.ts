import { describe, it, expect } from "vitest";
import {
  toServiceSummaryDTO,
  toServiceDetailDTO,
  toProviderPublicDTO,
  toCategoryDTO,
  toAvailabilitySlotDTO,
} from "./dtos";

// An empty, fully-absent Service Information Model — legacy service with nothing
// authored. Every ServiceDetail fixture below carries it so the mapper's info
// pass-through is exercised without any fixture asserting specific content.
const EMPTY_INFO = {
  durationMinutes: null,
  startInstructions: null,
  inclusions: [],
  exclusions: [],
  customerRequirements: [],
  minBookingSeats: null,
  maxBookingSeats: null,
};

// These mappers are the no-leak boundary: they copy an allow-list of public
// fields only (never a spread), converting money → MoneyDTO string and Date →
// ISO-8601. Tests assert exact shapes AND the absence of internal fields.

describe("toServiceSummaryDTO", () => {
  it("maps to the public DTO with MoneyDTO amount as a string and ISO date", () => {
    const dto = toServiceSummaryDTO({
      id: "s1",
      name: "Desert Safari",
      providerId: "p1",
      providerName: "Desert Co",
      price: "25 OMR",
      priceIsFrom: true,
      regionCode: "DHOFAR",
      pricingUnit: "PER_PERSON",
      bookability: "BOOKABLE_NOW",
      coverUrl: "https://cdn/x.jpg",
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
    });
    // EXACT equality — this is the wire allow-list, so a leaked internal field must fail here.
    expect(dto).toEqual({
      id: "s1",
      name: "Desert Safari",
      providerId: "p1",
      providerName: "Desert Co",
      price: { amount: "25.00", currency: "OMR" },
      priceIsFrom: true,
      regionCode: "DHOFAR",
      pricingUnit: "PER_PERSON",
      bookability: "BOOKABLE_NOW",
      coverUrl: "https://cdn/x.jpg",
      createdAt: "2026-01-02T03:04:05.000Z",
    });
    expect(typeof dto.price!.amount).toBe("string");
  });

  it("maps a null price to null", () => {
    const dto = toServiceSummaryDTO({
      id: "s1",
      name: "n",
      providerId: "p1",
      providerName: "pn",
      price: null,
      priceIsFrom: false,
      regionCode: null,
      pricingUnit: null,
      bookability: "UNAVAILABLE",
      coverUrl: null,
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    expect(dto.price).toBeNull();
    expect(dto.priceIsFrom).toBe(false);
    expect(dto.bookability).toBe("UNAVAILABLE");
  });
});

describe("toServiceDetailDTO", () => {
  it("serializes active prices as MoneyDTO and derives providerVerified", () => {
    const dto = toServiceDetailDTO(
      {
        id: "s1",
        name: "Safari",
        description: "desc",
        providerId: "p1",
        providerName: "Desert Co",
        providerDescription: "pdesc",
        providerStatus: "APPROVED",
        price: "25 OMR",
        priceIsFrom: true,
        regionCode: "DHOFAR",
        pricingUnit: "PER_PERSON",
        coverUrl: "https://cdn/c.jpg",
        gallery: ["https://cdn/g1.jpg"],
        info: EMPTY_INFO, createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      [
        { id: "pr1", amount: "25", currency: "OMR", pricingUnit: "PER_PERSON", pricingUnitLabel: "per person" },
        { id: "pr2", amount: "40.5", currency: "OMR", pricingUnit: "PER_DAY", pricingUnitLabel: "per day" },
      ],
      { averageRating: 4.5, reviewCount: 3 }
    );
    expect(dto.providerVerified).toBe(true);
    // EXACT equality, kept exact: this is the wire allow-list for a price option, so an
    // internal Price field leaking in must fail here. BOOKING-PRICE-SEMANTICS — the two
    // options carry DIFFERENT units, which is the case the whole gate exists for: two bare
    // amounts are not a choice a customer can make.
    expect(dto.activePrices).toEqual([
      {
        id: "pr1",
        price: { amount: "25.00", currency: "OMR" },
        pricingUnit: "PER_PERSON",
        pricingUnitLabel: "per person",
      },
      {
        id: "pr2",
        price: { amount: "40.50", currency: "OMR" },
        pricingUnit: "PER_DAY",
        pricingUnitLabel: "per day",
      },
    ]);
    // The SERVICE-level unit must not be what labels the list: it comes from the first
    // active price only, so using it would mislabel every other option.
    expect(dto.pricingUnit).toBe("PER_PERSON");
    expect(dto.activePrices[1]!.pricingUnit).not.toBe(dto.pricingUnit);
    expect(dto.ratingAverage).toBe(4.5);
    expect(dto.reviewCount).toBe(3);
    expect(dto.createdAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("providerVerified is false for a non-APPROVED status", () => {
    const dto = toServiceDetailDTO(
      {
        id: "s1", name: "n", description: "", providerId: "p1", providerName: "pn",
        providerDescription: "", providerStatus: "UNDER_REVIEW", price: null,
        regionCode: null, pricingUnit: null, priceIsFrom: false, coverUrl: null, gallery: [],
        info: EMPTY_INFO, createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      [],
      { averageRating: null, reviewCount: 0 }
    );
    expect(dto.providerVerified).toBe(false);
    expect(dto.price).toBeNull();
  });

  it("SERVICE INFORMATION MODEL — passes the localized service-info through verbatim", () => {
    const info = {
      durationMinutes: 120,
      startInstructions: "Meet at the marina",
      inclusions: ["Water", "Guide"],
      exclusions: ["Tips"],
      customerRequirements: ["Bring an ID"],
      minBookingSeats: 2,
      maxBookingSeats: 6,
    };
    const dto = toServiceDetailDTO(
      {
        id: "s1", name: "n", description: "", providerId: "p1", providerName: "pn",
        providerDescription: "", providerStatus: "APPROVED", price: null,
        regionCode: null, pricingUnit: null, priceIsFrom: false, coverUrl: null, gallery: [],
        info, createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      [],
      { averageRating: null, reviewCount: 0 }
    );
    // The detail reader has already localized; the DTO is a straight pass-through.
    expect(dto.info).toEqual(info);
  });

  it("SERVICE INFORMATION MODEL — a legacy service with nothing authored carries the empty shape", () => {
    const dto = toServiceDetailDTO(
      {
        id: "s1", name: "n", description: "", providerId: "p1", providerName: "pn",
        providerDescription: "", providerStatus: "APPROVED", price: null,
        regionCode: null, pricingUnit: null, priceIsFrom: false, coverUrl: null, gallery: [],
        info: EMPTY_INFO, createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
      [],
      { averageRating: null, reviewCount: 0 }
    );
    expect(dto.info).toEqual({
      durationMinutes: null,
      startInstructions: null,
      inclusions: [],
      exclusions: [],
      customerRequirements: [],
      minBookingSeats: null,
      maxBookingSeats: null,
    });
  });

  it("TOUR-VEHICLE-3 — tourVehicleSummary defaults to null and passes through a customer-safe summary (no private fields)", async () => {
    const base = {
      id: "s1", name: "n", description: "", providerId: "p1", providerName: "pn",
      providerDescription: "", providerStatus: "APPROVED", price: null,
      regionCode: null, pricingUnit: null, priceIsFrom: false, coverUrl: null, gallery: [],
      info: EMPTY_INFO, createdAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    // Omitted → null (non-tour service).
    expect(toServiceDetailDTO(base, [], { averageRating: null, reviewCount: 0 }).tourVehicleSummary).toBeNull();

    const summary = {
      transportIncluded: true,
      requiresFourByFour: false,
      vehicles: [{ make: "Toyota", model: "Prado", modelYear: 2024, color: "White", passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false }],
    };
    const dto = toServiceDetailDTO(base, [], { averageRating: null, reviewCount: 0 }, summary, "en");
    // EXACT equality, deliberately still exact: this is the wire allow-list for a
    // representative vehicle, so a read-model field leaking through must fail here. The
    // summary is no longer passed through by reference — the adapter maps it field by
    // field and adds the localized type label.
    expect(dto.tourVehicleSummary).toEqual({
      transportIncluded: true,
      requiresFourByFour: false,
      vehicles: [{
        make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
        passengerCapacity: 6, vehicleType: "SUV", vehicleTypeLabel: "SUV", isFourByFour: false,
      }],
    });
    // The vehicle carries no private / pool-join fields.
    const v = dto.tourVehicleSummary!.vehicles[0]! as unknown as Record<string, unknown>;
    for (const forbidden of ["registrationNumber", "claimedFourByFour", "fourByFourVerified", "vehicleId", "assetId", "isInPool", "blockers", "status", "objectKey"]) {
      expect(v[forbidden]).toBeUndefined();
    }
  });
});

  // TOUR-VEHICLE-TYPE-LABEL — the type CODE is stable and the LABEL is localized, exactly
  // as pricingUnit/pricingUnitLabel already are. A client should never have to mirror the
  // Platform's vehicle-type vocabulary to show it.
describe("toServiceDetailDTO — vehicleTypeLabel", () => {
    const base = {
      id: "s1", name: "n", description: "", providerId: "p1", providerName: "pn",
      providerDescription: "", providerStatus: "APPROVED", price: null,
      regionCode: null, pricingUnit: null, priceIsFrom: false, coverUrl: null, gallery: [],
      info: EMPTY_INFO, createdAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    function vehicle(vehicleType: string | null) {
      return {
        make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
        passengerCapacity: 6, vehicleType, isFourByFour: false,
      };
    }

    function summaryOf(...types: (string | null)[]) {
      return { transportIncluded: true, requiresFourByFour: false, vehicles: types.map(vehicle) };
    }

    function vehiclesFor(locale: "en" | "ar", ...types: (string | null)[]) {
      return toServiceDetailDTO(
        base, [], { averageRating: null, reviewCount: 0 }, summaryOf(...types), locale
      ).tourVehicleSummary!.vehicles;
    }

    it("localizes a known type in English", () => {
      const [v] = vehiclesFor("en", "SEDAN");
      expect(v!.vehicleType).toBe("SEDAN");
      expect(v!.vehicleTypeLabel).toBe("Sedan");
    });

    it("localizes the same type in Arabic", () => {
      const [v] = vehiclesFor("ar", "SEDAN");
      expect(v!.vehicleTypeLabel).toBe("سيارة سيدان");
    });

    /**
     * THE CODE IS THE STABLE HALF. It must be byte-identical across locales, or a client
     * that branches on it would behave differently per language.
     */
    it("keeps the code identical across locales while the label changes", () => {
      const [en] = vehiclesFor("en", "SEDAN");
      const [ar] = vehiclesFor("ar", "SEDAN");

      expect(en!.vehicleType).toBe(ar!.vehicleType);
      expect(en!.vehicleTypeLabel).not.toBe(ar!.vehicleTypeLabel);
    });

    it("localizes the structurally meaningful four-by-four type", () => {
      expect(vehiclesFor("en", "FOUR_BY_FOUR")[0]!.vehicleTypeLabel).toBe("4x4");
      expect(vehiclesFor("ar", "FOUR_BY_FOUR")[0]!.vehicleTypeLabel).toBe("دفع رباعي (4x4)");
    });

    /**
     * AN UNGOVERNED CODE STAYS UNLABELLED. The registry is app-owned and can grow, so a
     * stored code this build does not know keeps its stable value on the wire but resolves
     * to NO label — never promoted into display text.
     */
    it("returns a null label for a code the registry does not govern", () => {
      const [v] = vehiclesFor("en", "HOVERCRAFT");

      expect(v!.vehicleType).toBe("HOVERCRAFT");
      expect(v!.vehicleTypeLabel).toBeNull();
    });

    it("never falls back to the raw code as the label", () => {
      for (const type of ["HOVERCRAFT", "SUBMARINE", "FOUR_BY_FOUR"]) {
        const [v] = vehiclesFor("en", type);
        expect(v!.vehicleTypeLabel).not.toBe(v!.vehicleType);
      }
    });

    it("returns a null label when there is no type at all", () => {
      const [v] = vehiclesFor("en", null);

      expect(v!.vehicleType).toBeNull();
      expect(v!.vehicleTypeLabel).toBeNull();
    });

    /** Each vehicle resolves on its own; one unknown type does not blank its neighbours. */
    it("resolves every vehicle in a list independently and in server order", () => {
      const vehicles = vehiclesFor("en", "SEDAN", "HOVERCRAFT", "VAN");

      expect(vehicles.map((v) => v.vehicleType)).toEqual(["SEDAN", "HOVERCRAFT", "VAN"]);
      expect(vehicles.map((v) => v.vehicleTypeLabel)).toEqual(["Sedan", null, "Van"]);
    });

    /** The rest of the summary is untouched by this gate. */
    it("leaves the package promise and the null summary unchanged", () => {
      const dto = toServiceDetailDTO(
        base, [], { averageRating: null, reviewCount: 0 },
        { transportIncluded: true, requiresFourByFour: true, vehicles: [] }, "en"
      );

      expect(dto.tourVehicleSummary).toEqual({
        transportIncluded: true, requiresFourByFour: true, vehicles: [],
      });
      expect(
        toServiceDetailDTO(base, [], { averageRating: null, reviewCount: 0 }, null, "en")
          .tourVehicleSummary
      ).toBeNull();
    });

    /** The allow-list still holds once a field has been added to it. */
    it("exposes exactly the eight contract fields per vehicle", () => {
      const [v] = vehiclesFor("en", "SUV");

      expect(Object.keys(v!).sort()).toEqual([
        "color", "isFourByFour", "make", "model", "modelYear",
        "passengerCapacity", "vehicleType", "vehicleTypeLabel",
      ]);
    });
  });

describe("toProviderPublicDTO — BR-002 / no-leak", () => {
  it("maps only public fields and never exposes contactEmail or internal fields", () => {
    // Source shaped like ProviderProfile PLUS hostile extra internal fields that
    // must NOT survive the allow-list mapper.
    const source = {
      id: "p1",
      name: "Desert Co",
      description: "d",
      status: "APPROVED",
      providerType: "COMPANY",
      city: "Salalah",
      logoUrl: "https://cdn/logo.jpg",
      coverUrl: "https://cdn/cover.jpg",
      portfolio: ["https://cdn/1.jpg"],
      publishedServicesCount: 4,
      averageRating: 4.2,
      reviewCount: 10,
      categories: [{ id: "c1", slug: "tours", label: "Tours" }],
      // hostile internals (not part of ProviderProfile) — must be dropped:
      contactEmail: "secret@provider.com",
      userId: "u1",
      authUserId: "au1",
    } as never;

    const dto = toProviderPublicDTO(source);
    expect(dto.verified).toBe(true);
    expect(dto.categories).toEqual([{ id: "c1", slug: "tours", label: "Tours" }]);
    const keys = Object.keys(dto);
    expect(keys).not.toContain("contactEmail");
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("authUserId");
    expect(JSON.stringify(dto)).not.toContain("secret@provider.com");
  });
});

describe("toCategoryDTO", () => {
  it("maps id/slug/label", () => {
    expect(toCategoryDTO({ id: "c1", slug: "tours", label: "الجولات" })).toEqual({
      id: "c1",
      slug: "tours",
      label: "الجولات",
    });
  });
});

describe("toAvailabilitySlotDTO", () => {
  it("maps with ISO dates and remainingSeats", () => {
    expect(
      toAvailabilitySlotDTO({
        id: "a1",
        startTime: new Date("2026-06-01T09:00:00.000Z"),
        endTime: new Date("2026-06-01T12:00:00.000Z"),
        remainingSeats: 4,
      })
    ).toEqual({
      id: "a1",
      startTime: "2026-06-01T09:00:00.000Z",
      endTime: "2026-06-01T12:00:00.000Z",
      remainingSeats: 4,
    });
  });
});
