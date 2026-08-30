import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

const getDetailMock = vi.fn();
vi.mock("@/lib/provider/queries/get-provider-booking-detail", () => ({
  getProviderBookingDetail: (...a: unknown[]) => getDetailMock(...a),
}));

const { GET } = await import("./route");
beforeEach(() => getDetailMock.mockReset());
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/v1/me/provider/bookings/{id}", () => {
  it("404 uniform for invalid/missing/not-owned (anti-enumeration)", async () => {
    getDetailMock.mockResolvedValue(null);
    const res = await GET(new Request("http://x/api/v1/me/provider/bookings/x?locale=en"), params("x"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("200 maps detail; no customer PII", async () => {
    getDetailMock.mockResolvedValue({
      id: "b1",
      serviceId: "s1",
      serviceName: "Safari",
      status: "CONFIRMED",
      seats: 2,
      priceSnapshot: "25 OMR",
      bookingMoney: { available: true, moneyMode: "LEGACY", total: "25.00", unitAmount: "25.00", currency: "OMR", pricingUnit: null, billableQuantity: null },
      slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    const res = await GET(new Request("http://x/api/v1/me/provider/bookings/b1?locale=en"), params("b1"));
    expect(res.status).toBe(200);
    expect(getDetailMock).toHaveBeenCalledWith("b1", "en");
    const body = await res.json();
    expect(body.priceSnapshot).toEqual({ amount: "25.00", currency: "OMR" });
    expect(body.serviceId).toBe("s1");
    expect(JSON.stringify(body)).not.toContain("customerId");
  });

  // ASSIGNED-VEHICLE-TYPE-LABEL — the provider surface inherits the localized label and must
  // receive its OWN locale, not a default. Before locale was required, a forgotten argument
  // here would have answered every provider in the default language.
  describe("provider assigned vehicle type label locale threading", () => {
    async function vehicleFor(locale: string) {
      getDetailMock.mockResolvedValue({
        id: "b1", serviceId: "s1", serviceName: "Safari", status: "CONFIRMED", seats: 2,
        priceSnapshot: null, bookingMoney: { available: false }, slotStartTime: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        assignedVehicle: { make: "Toyota", model: "Prado", modelYear: 2024, color: "White", passengerCapacity: 6, vehicleType: "SEDAN", isFourByFour: false, registrationNumber: "QA-TV2-0001" },
      });
      const res = await GET(
        new Request("http://x/api/v1/me/provider/bookings/b1", {
          headers: { "Accept-Language": locale },
        }),
        params("b1")
      );
      return (await res.json()).assignedVehicle;
    }

    it("resolves the label in English", async () => {
      const v = await vehicleFor("en");
      expect(v.vehicleType).toBe("SEDAN");
      expect(v.vehicleTypeLabel).toBe("Sedan");
    });

    it("resolves the label in Arabic while the code stays identical", async () => {
      const en = await vehicleFor("en");
      const ar = await vehicleFor("ar");
      expect(ar.vehicleTypeLabel).toBe("سيارة سيدان");
      expect(ar.vehicleType).toBe(en.vehicleType);
    });

    /** The provider-only plate must survive alongside the new label. */
    it("keeps the provider-only plate", async () => {
      expect((await vehicleFor("en")).registrationNumber).toBe("QA-TV2-0001");
    });
  });
});
