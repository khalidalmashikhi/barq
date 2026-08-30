import { describe, it, expect, beforeEach, vi } from "vitest";

// Auth-gate mapping covered in src/lib/api/v1/provider-auth.test.ts.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

const getBookingsMock = vi.fn();
vi.mock("@/lib/provider/queries/get-provider-bookings", () => ({
  getProviderBookings: (...a: unknown[]) => getBookingsMock(...a),
}));

const { GET } = await import("./route");
beforeEach(() => getBookingsMock.mockReset());

describe("GET /api/v1/me/provider/bookings", () => {
  it("200 maps DTOs with NO customer PII; money as string; status filter forwarded", async () => {
    getBookingsMock.mockResolvedValue({
      items: [
        {
          id: "b1",
          serviceName: "Safari",
          status: "PENDING_PROVIDER",
          seats: 2,
          priceSnapshot: "25 OMR",
          bookingMoney: { available: true, moneyMode: "LEGACY", total: "25.00", unitAmount: "25.00", currency: "OMR", pricingUnit: null, billableQuantity: null },
          slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
          availabilityId: "a1",
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
    });
    const res = await GET(new Request("http://x/api/v1/me/provider/bookings?locale=en&status=PENDING_PROVIDER"));
    expect(res.status).toBe(200);
    expect(getBookingsMock).toHaveBeenCalledWith(expect.objectContaining({ status: "PENDING_PROVIDER" }), "en");
    const body = await res.json();
    expect(body.items[0]).toEqual({
      id: "b1",
      serviceName: "Safari",
      status: "PENDING_PROVIDER",
      seats: 2,
      priceSnapshot: { amount: "25.00", currency: "OMR" },
      // BOOKING TOTAL PRESENTATION — additive money fields (LEGACY → total == unit).
      bookingTotal: { amount: "25.00", currency: "OMR" },
      moneyMode: "LEGACY",
      pricingUnit: null,
      billableQuantity: null,
      scheduledStartTime: "2026-06-01T09:00:00.000Z",
      availabilityId: "a1",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    const s = JSON.stringify(body);
    expect(s).not.toContain("customerId");
    expect(s).not.toContain("phone");
  });
});
