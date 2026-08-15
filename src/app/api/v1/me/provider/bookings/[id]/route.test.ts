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
});
