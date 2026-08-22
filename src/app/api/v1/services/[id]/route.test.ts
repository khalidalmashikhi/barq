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
    getActivePricesMock.mockResolvedValue([{ id: "pr1", amount: "25", currency: "OMR" }]);
    getRatingMock.mockResolvedValue({ averageRating: 4.5, reviewCount: 2 });
    getTourVehicleSummaryMock.mockResolvedValue(null); // non-tour

    const res = await GET(new Request("http://localhost/api/v1/services/s1?locale=en"), params("s1"));

    expect(res.status).toBe(200);
    expect(getServiceByIdMock).toHaveBeenCalledWith("s1", "en");
    const body = await res.json();
    expect(body.providerVerified).toBe(true);
    expect(body.activePrices).toEqual([{ id: "pr1", price: { amount: "25.00", currency: "OMR" } }]);
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
});
