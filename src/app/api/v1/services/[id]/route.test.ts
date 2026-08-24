import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_name: string, handler: () => Promise<Response>) => handler(),
}));

const getServiceByIdMock = vi.fn();
const getActivePricesMock = vi.fn();
const getRatingMock = vi.fn();
vi.mock("@/lib/services/get-service-detail", () => ({
  getServiceById: (...args: unknown[]) => getServiceByIdMock(...args),
  getActivePricesForService: (...args: unknown[]) => getActivePricesMock(...args),
  getServiceRatingAggregate: (...args: unknown[]) => getRatingMock(...args),
}));

// TOUR-VEHICLE-3 — the route also composes the customer-safe tour vehicle summary.
const getTourVehicleSummaryMock = vi.fn();
vi.mock("@/lib/tour-template/vehicle-pool/public-tour-vehicles", () => ({
  getPublicTourVehicleSummary: (...args: unknown[]) => getTourVehicleSummaryMock(...args),
}));

const { GET } = await import("./route");

afterEach(() => {
  getServiceByIdMock.mockReset();
  getActivePricesMock.mockReset();
  getRatingMock.mockReset();
  getTourVehicleSummaryMock.mockReset();
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/v1/services/{id}", () => {
  it("returns 404 (no-store) with the error envelope when the service is not public/available", async () => {
    getServiceByIdMock.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/v1/services/s1?locale=en"), params("s1"));

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "The requested resource was not found." },
    });
    // uniform 404: active prices / rating never fetched for an unavailable service
    expect(getActivePricesMock).not.toHaveBeenCalled();
  });

  it("returns 200 with detail DTO, active prices as MoneyDTO, and rating", async () => {
    getServiceByIdMock.mockResolvedValue({
      id: "s1",
      name: "Safari",
      description: "d",
      providerId: "p1",
      providerName: "Desert Co",
      providerDescription: "pd",
      providerStatus: "APPROVED",
      price: "25 OMR",
      regionCode: "DHOFAR",
      pricingUnit: "PER_PERSON",
      coverUrl: "https://cdn/c.jpg",
      gallery: ["https://cdn/g1.jpg"],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    getActivePricesMock.mockResolvedValue([
      { id: "pr1", amount: "25", currency: "OMR", pricingUnit: "PER_PERSON", pricingUnitLabel: "per person" },
    ]);
    getRatingMock.mockResolvedValue({ averageRating: 4.5, reviewCount: 2 });
    getTourVehicleSummaryMock.mockResolvedValue(null); // non-tour

    const res = await GET(new Request("http://localhost/api/v1/services/s1?locale=en"), params("s1"));

    expect(res.status).toBe(200);
    expect(getServiceByIdMock).toHaveBeenCalledWith("s1", "en");
    const body = await res.json();
    expect(body.providerVerified).toBe(true);
    expect(body.activePrices).toEqual([
      {
        id: "pr1",
        price: { amount: "25.00", currency: "OMR" },
        pricingUnit: "PER_PERSON",
        pricingUnitLabel: "per person",
      },
    ]);
    expect(body.ratingAverage).toBe(4.5);
    expect(body.tourVehicleSummary).toBeNull();
    expect(JSON.stringify(body)).not.toContain("contactEmail");
  });

  it("TOUR-VEHICLE-3 — includes the customer-safe tour vehicle summary with no private fields", async () => {
    getServiceByIdMock.mockResolvedValue({
      id: "s1", name: "Safari", description: "d", providerId: "p1", providerName: "Desert Co",
      providerDescription: "pd", providerStatus: "APPROVED", price: "25 OMR", regionCode: null,
      pricingUnit: null, coverUrl: null, gallery: [], createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    getActivePricesMock.mockResolvedValue([]);
    getRatingMock.mockResolvedValue({ averageRating: null, reviewCount: 0 });
    getTourVehicleSummaryMock.mockResolvedValue({
      transportIncluded: true, requiresFourByFour: false,
      vehicles: [{ make: "Toyota", model: "Prado", modelYear: 2024, color: "White", passengerCapacity: 6, vehicleType: "SUV", isFourByFour: false }],
    });

    const res = await GET(new Request("http://localhost/api/v1/services/s1?locale=en"), params("s1"));
    const body = await res.json();
    expect(getTourVehicleSummaryMock).toHaveBeenCalledWith("s1");
    expect(body.tourVehicleSummary.transportIncluded).toBe(true);
    expect(body.tourVehicleSummary.vehicles[0].make).toBe("Toyota");
    // No private / pool-join fields on the wire.
    const s = JSON.stringify(body);
    for (const forbidden of ["registrationNumber", "claimedFourByFour", "fourByFourVerified", "objectKey", "vehicleId", "assetId", "isInPool", "blockers", "verificationStatus"]) {
      expect(s).not.toContain(forbidden);
    }
  });

  // TOUR-VEHICLE-TYPE-LABEL — the type label is resolved by the PLATFORM, per request
  // locale, so no native client mirrors the vehicle-type registry.
  describe("tour vehicle type label", () => {
    function serviceRow() {
      return {
        id: "s1", name: "n", description: "", providerId: "p1", providerName: "pn",
        providerDescription: "", providerStatus: "APPROVED", price: null,
        regionCode: null, pricingUnit: null, coverUrl: null, gallery: [],
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      };
    }

    function arrange(vehicleType: string | null) {
      getServiceByIdMock.mockResolvedValue(serviceRow());
      getActivePricesMock.mockResolvedValue([]);
      getRatingMock.mockResolvedValue({ averageRating: null, reviewCount: 0 });
      getTourVehicleSummaryMock.mockResolvedValue({
        transportIncluded: true,
        requiresFourByFour: false,
        vehicles: [{
          make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
          passengerCapacity: 6, vehicleType, isFourByFour: false,
        }],
      });
    }

    async function vehicleFor(locale: string, vehicleType: string | null = "SEDAN") {
      arrange(vehicleType);
      const res = await GET(
        new Request("http://localhost/api/v1/services/s1", {
          headers: { "Accept-Language": locale },
        }),
        params("s1")
      );
      return (await res.json()).tourVehicleSummary.vehicles[0];
    }

    it("resolves the type label in English", async () => {
      const vehicle = await vehicleFor("en");

      expect(vehicle.vehicleType).toBe("SEDAN");
      expect(vehicle.vehicleTypeLabel).toBe("Sedan");
    });

    it("resolves the same type in Arabic", async () => {
      const vehicle = await vehicleFor("ar");

      expect(vehicle.vehicleTypeLabel).toBe("سيارة سيدان");
    });

    /** The CODE is what a client branches on, so it must not vary by language. */
    it("keeps the code identical across locales while the label changes", async () => {
      const en = await vehicleFor("en");
      const ar = await vehicleFor("ar");

      expect(en.vehicleType).toBe(ar.vehicleType);
      expect(en.vehicleTypeLabel).not.toBe(ar.vehicleTypeLabel);
    });

    /**
     * A code the registry does not govern keeps its stable value on the wire but carries NO
     * label — a raw SCREAMING_CASE code must never be handed to a client as display text.
     */
    it("sends a null label for an ungoverned code, never the code itself", async () => {
      const vehicle = await vehicleFor("en", "HOVERCRAFT");

      expect(vehicle.vehicleType).toBe("HOVERCRAFT");
      expect(vehicle.vehicleTypeLabel).toBeNull();
    });

    it("sends a null label when the vehicle has no type", async () => {
      const vehicle = await vehicleFor("en", null);

      expect(vehicle.vehicleType).toBeNull();
      expect(vehicle.vehicleTypeLabel).toBeNull();
    });

    /** The privacy allow-list is unchanged by adding a derived label. */
    it("adds no private field alongside the new label", async () => {
      arrange("SUV");
      const res = await GET(new Request("http://localhost/api/v1/services/s1"), params("s1"));
      const body = await res.json();

      expect(Object.keys(body.tourVehicleSummary.vehicles[0]).sort()).toEqual([
        "color", "isFourByFour", "make", "model", "modelYear",
        "passengerCapacity", "vehicleType", "vehicleTypeLabel",
      ]);
      const serialized = JSON.stringify(body);
      for (const forbidden of [
        "registrationNumber", "claimedFourByFour", "fourByFourVerified", "objectKey",
        "vehicleId", "assetId", "isInPool", "blockers", "verificationStatus",
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    });

    it("still sends a null summary for a non-tour service", async () => {
      getServiceByIdMock.mockResolvedValue(serviceRow());
      getActivePricesMock.mockResolvedValue([]);
      getRatingMock.mockResolvedValue({ averageRating: null, reviewCount: 0 });
      getTourVehicleSummaryMock.mockResolvedValue(null);

      const res = await GET(new Request("http://localhost/api/v1/services/s1"), params("s1"));

      expect((await res.json()).tourVehicleSummary).toBeNull();
    });
  });

  // BOOKING-PRICE-SEMANTICS — the unit label is resolved by the PLATFORM, per request
  // locale, so no client ever mirrors the pricing-unit registry.
  describe("active price locale plumbing", () => {
  /** The minimum a service row needs for toServiceDetailDTO() to map it. */
  function serviceRow() {
    return {
      id: "s1", name: "n", description: "", providerId: "p1", providerName: "pn",
      providerDescription: "", providerStatus: "APPROVED", price: null,
      regionCode: null, pricingUnit: null, coverUrl: null, gallery: [],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  }
    it("passes the resolved locale to the active-price reader", async () => {
      getServiceByIdMock.mockResolvedValue(serviceRow());
      getActivePricesMock.mockResolvedValue([]);
      getRatingMock.mockResolvedValue({ averageRating: null, reviewCount: 0 });
      getTourVehicleSummaryMock.mockResolvedValue(null);

      await GET(
        new Request("http://localhost/api/v1/services/s1", { headers: { "Accept-Language": "ar" } }),
        params("s1")
      );

      expect(getActivePricesMock).toHaveBeenCalledWith("s1", "ar");
    });

    it("passes English when the caller asks for English", async () => {
      getServiceByIdMock.mockResolvedValue(serviceRow());
      getActivePricesMock.mockResolvedValue([]);
      getRatingMock.mockResolvedValue({ averageRating: null, reviewCount: 0 });
      getTourVehicleSummaryMock.mockResolvedValue(null);

      await GET(
        new Request("http://localhost/api/v1/services/s1", { headers: { "Accept-Language": "en" } }),
        params("s1")
      );

      expect(getActivePricesMock).toHaveBeenCalledWith("s1", "en");
    });

    /** A legacy flat price, and a unit the registry does not yet govern. */
    it("carries a null label for an absent or not-yet-governed unit, never a raw code", async () => {
      getServiceByIdMock.mockResolvedValue(serviceRow());
      getRatingMock.mockResolvedValue({ averageRating: null, reviewCount: 0 });
      getTourVehicleSummaryMock.mockResolvedValue(null);
      getActivePricesMock.mockResolvedValue([
        { id: "legacy", amount: "5", currency: "OMR", pricingUnit: null, pricingUnitLabel: null },
        { id: "future", amount: "9", currency: "OMR", pricingUnit: "PER_NIGHT", pricingUnitLabel: null },
      ]);

      const res = await GET(new Request("http://localhost/api/v1/services/s1"), params("s1"));
      const body = await res.json();

      expect(body.activePrices[0].pricingUnit).toBeNull();
      expect(body.activePrices[0].pricingUnitLabel).toBeNull();
      // The stable code still travels — a client may branch on it — but there is no
      // label, so it can never be rendered at a customer.
      expect(body.activePrices[1].pricingUnit).toBe("PER_NIGHT");
      expect(body.activePrices[1].pricingUnitLabel).toBeNull();
    });
  });
});
