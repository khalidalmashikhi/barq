import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return { requireAuth: vi.fn(), UnauthenticatedError, ForbiddenError };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/auth", () => ({
  requireAuth: (...a: unknown[]) => h.requireAuth(...a),
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
}));

const getBookingDetailMock = vi.fn();
vi.mock("@/lib/booking/get-booking-detail", () => ({
  getBookingDetail: (...a: unknown[]) => getBookingDetailMock(...a),
}));

const { GET } = await import("./route");

beforeEach(() => {
  h.requireAuth.mockReset();
  getBookingDetailMock.mockReset();
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/v1/me/bookings/{id}", () => {
  it("401 without a session", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());
    const res = await GET(new Request("http://x/api/v1/me/bookings/b1"), params("b1"));
    expect(res.status).toBe(401);
    expect(getBookingDetailMock).not.toHaveBeenCalled();
  });

  it("404 (uniform) when the booking is not the caller's / does not exist / invalid id", async () => {
    h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
    getBookingDetailMock.mockResolvedValue(null); // reader enforces ownership + returns null uniformly
    const res = await GET(new Request("http://x/api/v1/me/bookings/someone-elses?locale=en"), params("someone-elses"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: "NOT_FOUND", message: "The requested resource was not found." },
    });
  });

  it("200 returns the caller's own booking detail; MoneyDTO string; no internal leakage", async () => {
    h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
    getBookingDetailMock.mockResolvedValue({
      id: "b1",
      serviceId: "s1",
      providerId: "p1",
      serviceName: "Safari",
      providerName: "Desert Co",
      status: "CONFIRMED",
      priceSnapshot: "25 OMR",
      seats: 2,
      slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
      confirmedAt: new Date("2026-05-02T00:00:00.000Z"),
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      hasReview: false,
      paymentId: "pay1",
    });

    const res = await GET(new Request("http://x/api/v1/me/bookings/b1?locale=en"), params("b1"));
    expect(res.status).toBe(200);
    expect(getBookingDetailMock).toHaveBeenCalledWith("b1", "en");
    const body = await res.json();
    expect(body.priceSnapshot).toEqual({ amount: "25.00", currency: "OMR" });
    expect(body.seats).toBe(2);
    expect(JSON.stringify(body)).not.toContain("contactEmail");
    expect(JSON.stringify(body)).not.toContain("customerId");
  });

  // ASSIGNED-VEHICLE-TYPE-LABEL — the route must hand its resolved locale to the mapper.
  // Asserted through the RESPONSE rather than with a spy: a spy proves an argument was
  // passed, this proves the customer actually receives the right language.
  describe("assigned vehicle type label locale threading", () => {
    function arrange() {
      h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
      getBookingDetailMock.mockResolvedValue({
        id: "b1", serviceId: "s1", providerId: "p1", serviceName: "Safari",
        providerName: "Desert Co", status: "CONFIRMED", priceSnapshot: null, seats: 1,
        slotStartTime: null, confirmedAt: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"), hasReview: false, paymentId: null,
        assignedVehicle: { make: "Toyota", model: "Prado", modelYear: 2024, color: "White", passengerCapacity: 6, vehicleType: "SEDAN", isFourByFour: false },
      });
    }

    async function vehicleFor(locale: string) {
      arrange();
      const res = await GET(
        new Request("http://x/api/v1/me/bookings/b1", { headers: { "Accept-Language": locale } }),
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

    it("still sends no plate or private field alongside the label", async () => {
      const v = await vehicleFor("en");
      expect(Object.keys(v).sort()).toEqual([
        "color", "isFourByFour", "make", "model", "modelYear",
        "passengerCapacity", "vehicleType", "vehicleTypeLabel",
      ]);
    });
  });
});
