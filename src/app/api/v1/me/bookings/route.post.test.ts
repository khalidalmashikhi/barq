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

const createBookingMock = vi.fn();
const getBookingDetailMock = vi.fn();
vi.mock("@/lib/booking/create-booking", () => ({ createBooking: (...a: unknown[]) => createBookingMock(...a) }));
vi.mock("@/lib/booking/get-booking-detail", () => ({ getBookingDetail: (...a: unknown[]) => getBookingDetailMock(...a) }));
vi.mock("@/lib/booking/get-my-bookings", () => ({ getMyBookings: vi.fn() }));

const { POST } = await import("./route");

beforeEach(() => {
  h.requireAuth.mockReset();
  createBookingMock.mockReset();
  getBookingDetailMock.mockReset();
  h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
});

function post(body: unknown, url = "http://x/api/v1/me/bookings?locale=en") {
  return new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

const DETAIL = {
  id: "b1",
  serviceId: "s1",
  providerId: "p1",
  serviceName: "Safari",
  providerName: "Desert Co",
  status: "PENDING_PROVIDER",
  priceSnapshot: "25 OMR",
  seats: 2,
  slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
  confirmedAt: null,
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
  hasReview: false,
  paymentId: null,
};

describe("POST /api/v1/me/bookings", () => {
  it("401 unauthenticated (createBooking never called)", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());
    const res = await POST(post({ serviceId: "s1", priceId: "pr1" }));
    expect(res.status).toBe(401);
    expect(createBookingMock).not.toHaveBeenCalled();
  });

  it("400 INVALID_INPUT for a non-object body", async () => {
    const res = await POST(post(null));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
    expect(createBookingMock).not.toHaveBeenCalled();
  });

  it("forwards ONLY selection fields — client cannot spoof price/currency/provider/status/customerId", async () => {
    createBookingMock.mockResolvedValue({ ok: true, bookingId: "b1" });
    getBookingDetailMock.mockResolvedValue(DETAIL);
    await POST(
      post({
        serviceId: "s1",
        priceId: "pr1",
        availabilityId: "a1",
        seats: 2,
        // hostile spoof fields that MUST be dropped:
        price: "1.00",
        amount: "1.00",
        currency: "USD",
        providerId: "attacker",
        status: "CONFIRMED",
        customerId: "victim",
        bookedCount: 0,
        commission: "0",
      })
    );
    expect(createBookingMock).toHaveBeenCalledTimes(1);
    const fd = createBookingMock.mock.calls[0]![0] as FormData;
    expect([...fd.keys()].sort()).toEqual(["availabilityId", "priceId", "seats", "serviceId"]);
    expect(fd.get("serviceId")).toBe("s1");
    expect(fd.get("priceId")).toBe("pr1");
    // none of the spoofed authoritative fields were forwarded
    for (const k of ["price", "amount", "currency", "providerId", "status", "customerId", "bookedCount", "commission"]) {
      expect(fd.get(k)).toBeNull();
    }
  });

  it("201 returns the server-built BookingDetailDTO (price snapshot from server, MoneyDTO string, no leakage)", async () => {
    createBookingMock.mockResolvedValue({ ok: true, bookingId: "b1" });
    getBookingDetailMock.mockResolvedValue(DETAIL);
    const res = await POST(post({ serviceId: "s1", priceId: "pr1", availabilityId: "a1", seats: 2 }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // the just-created booking is re-read by the server (ownership-scoped)
    expect(getBookingDetailMock).toHaveBeenCalledWith("b1", "en");
    const body = await res.json();
    expect(body.booking.priceSnapshot).toEqual({ amount: "25.00", currency: "OMR" });
    expect(typeof body.booking.priceSnapshot.amount).toBe("string");
    expect(body.booking.status).toBe("PENDING_PROVIDER");
    expect(JSON.stringify(body)).not.toContain("customerId");
    expect(JSON.stringify(body)).not.toContain("authUserId");
  });

  it.each([
    ["NO_CUSTOMER_PROFILE", 403, "NO_CUSTOMER_PROFILE"],
    ["SERVICE_UNAVAILABLE", 422, "SERVICE_UNAVAILABLE"],
    ["PRICE_UNAVAILABLE", 422, "PRICE_UNAVAILABLE"],
    ["SLOT_REQUIRED", 422, "SLOT_REQUIRED"],
    ["SLOT_UNAVAILABLE", 422, "SLOT_UNAVAILABLE"],
    ["DUPLICATE_BOOKING", 422, "DUPLICATE_BOOKING"],
    ["SLOT_FULL", 409, "SLOT_FULL"],
    ["RATE_LIMITED", 429, "RATE_LIMITED"],
    ["INVALID_INPUT", 400, "INVALID_INPUT"],
    ["UNKNOWN_ERROR", 500, "INTERNAL_ERROR"],
  ] as const)("maps domain %s -> HTTP %i (%s)", async (domainCode, status, apiCode) => {
    createBookingMock.mockResolvedValue({ ok: false, error: domainCode });
    const res = await POST(post({ serviceId: "s1", priceId: "pr1" }));
    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.error.code).toBe(apiCode);
    expect(JSON.stringify(body)).not.toMatch(/prisma|stack|at Object|Error:/i);
    // detail is never read when creation failed
    expect(getBookingDetailMock).not.toHaveBeenCalled();
  });
});
