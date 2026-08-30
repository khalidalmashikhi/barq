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

const getMyBookingsMock = vi.fn();
vi.mock("@/lib/booking/get-my-bookings", () => ({
  getMyBookings: (...a: unknown[]) => getMyBookingsMock(...a),
}));
// route.ts also imports these for POST; stub them so this GET-focused test never
// loads the real Prisma-touching modules (POST is covered in route.post.test.ts).
vi.mock("@/lib/booking/create-booking", () => ({ createBooking: vi.fn() }));
vi.mock("@/lib/booking/get-booking-detail", () => ({ getBookingDetail: vi.fn() }));

const { createBooking } = await import("@/lib/booking/create-booking");
const { getBookingDetail } = await import("@/lib/booking/get-booking-detail");
const { GET, POST } = await import("./route");

beforeEach(() => {
  h.requireAuth.mockReset();
  getMyBookingsMock.mockReset();
});

describe("GET /api/v1/me/bookings", () => {
  it("401 without a session (and never calls the reader)", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());
    const res = await GET(new Request("http://x/api/v1/me/bookings"));
    expect(res.status).toBe(401);
    expect(getMyBookingsMock).not.toHaveBeenCalled();
  });

  it("200 maps own bookings, MoneyDTO string, clamps pageSize to 50, forwards locale", async () => {
    h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
    getMyBookingsMock.mockResolvedValue({
      items: [
        {
          id: "b1",
          serviceId: "svc-1",
          serviceName: "Desert Safari",
          status: "CONFIRMED",
          priceSnapshot: "25 OMR",
          bookingMoney: { available: true, moneyMode: "LEGACY", total: "25.00", unitAmount: "25.00", currency: "OMR", pricingUnit: null, billableQuantity: null },
          availabilityId: "av-1",
          slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
          createdAt: new Date("2026-05-01T00:00:00.000Z"),
        },
      ],
      totalCount: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    const res = await GET(new Request("http://x/api/v1/me/bookings?locale=en&pageSize=100&when=upcoming"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getMyBookingsMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 50, when: "upcoming" }),
      "en"
    );

    const body = await res.json();
    // EXACT equality, kept exact on purpose: this is the wire allow-list guard. It must
    // fail if any additional Booking field ever reaches a customer, so it is never
    // relaxed to toMatchObject/objectContaining.
    expect(body.items[0]).toEqual({
      id: "b1",
      status: "CONFIRMED",
      serviceId: "svc-1",
      serviceName: "Desert Safari",
      priceSnapshot: { amount: "25.00", currency: "OMR" },
      // BOOKING TOTAL PRESENTATION — additive money fields (LEGACY → total == unit).
      bookingTotal: { amount: "25.00", currency: "OMR" },
      moneyMode: "LEGACY",
      pricingUnit: null,
      billableQuantity: null,
      scheduledStartTime: "2026-06-01T09:00:00.000Z",
      availabilityId: "av-1",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    // Nothing private rides along.
    for (const forbidden of ["customerId", "providerId", "paymentId", "phone", "email"]) {
      expect(Object.keys(body.items[0])).not.toContain(forbidden);
    }
    expect(typeof body.items[0].priceSnapshot.amount).toBe("string");
    expect(body).toMatchObject({ page: 1, pageSize: 50, totalCount: 1, totalPages: 1 });
  });

  // ASSIGNED-VEHICLE-TYPE-LABEL — the 201 envelope returns a BookingDetailDTO, so the CREATE
  // route threads locale too. This caller was missed by the first scope projection, which is
  // exactly why it is pinned here.
  describe("create response assigned vehicle type label locale threading", () => {
    async function bookingFor(locale: string) {
      h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
      vi.mocked(createBooking).mockResolvedValue({ ok: true, bookingId: "b1" } as never);
      vi.mocked(getBookingDetail).mockResolvedValue({
        id: "b1", serviceId: "s1", providerId: "p1", serviceName: "Safari",
        providerName: "Desert Co", status: "PENDING_PROVIDER", priceSnapshot: null, bookingMoney: { available: false }, seats: 1,
        slotStartTime: null, confirmedAt: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"), hasReview: false, paymentId: null,
        assignedVehicle: {
          make: "Toyota", model: "Prado", modelYear: 2024, color: "White",
          passengerCapacity: 6, vehicleType: "SEDAN", isFourByFour: false,
        },
      } as never);

      const res = await POST(new Request("http://x/api/v1/me/bookings", {
        method: "POST",
        headers: { "Accept-Language": locale, "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: "s1", priceId: "p1" }),
      }));

      expect(res.status).toBe(201);
      return (await res.json()).booking;
    }

    it("localizes the label inside the 201 envelope", async () => {
      const booking = await bookingFor("en");
      expect(booking.assignedVehicle.vehicleType).toBe("SEDAN");
      expect(booking.assignedVehicle.vehicleTypeLabel).toBe("Sedan");
    });

    it("follows the caller's locale without changing the canonical code", async () => {
      const booking = await bookingFor("ar");
      expect(booking.assignedVehicle.vehicleTypeLabel).toBe("سيارة سيدان");
      expect(booking.assignedVehicle.vehicleType).toBe("SEDAN");
    });
  });

  // PLATFORM-BOOKING-INCOMPLETE-ERROR-1 — what a NATIVE client actually receives.
  //
  // Before this gate, createBooking() enforced dual verification by redirecting, so a
  // phone-only Android customer got a thrown NEXT_REDIRECT — followed by the HTTP client
  // into an HTML page and surfacing as an unexplained "something went wrong". These
  // tests pin the replacement: an ordinary, readable, localized JSON refusal.
});


// PLATFORM-BOOKING-INCOMPLETE-ERROR-1 — POST behaviour, at top level: this is a
// create-booking contract, not a listing one.
describe("POST /api/v1/me/bookings — incomplete customer", () => {
    describe("refusal contract", () => {
    beforeEach(() => {
      h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
      vi.mocked(createBooking).mockResolvedValue({
        ok: false,
        error: "CUSTOMER_INCOMPLETE",
      } as never);
      // File-wide spy: clear the count so the assertion below measures THIS request
      // rather than every booking read the suite has ever made.
      vi.mocked(getBookingDetail).mockClear();
    });

    function post(locale: string) {
      return POST(
        new Request("http://x/api/v1/me/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept-Language": locale },
          body: JSON.stringify({ serviceId: "s1", priceId: "p1" }),
        })
      );
    }

    it("answers 403 with the stable CUSTOMER_INCOMPLETE code", async () => {
      const res = await post("en");

      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("CUSTOMER_INCOMPLETE");
    });

    /**
     * NOT A REDIRECT. This is the whole point of the gate: no 3xx, no Location header,
     * and nothing that would send a native HTTP client to an HTML onboarding page.
     */
    it("is not a redirect and carries no Location header", async () => {
      const res = await post("en");

      expect(res.status).toBe(403);
      // The real assertion: NOT a 3xx. A redirect is what broke the native client.
      expect(res.status >= 300 && res.status < 400).toBe(false);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("leaks no NEXT_REDIRECT digest or onboarding path", async () => {
      const body = JSON.stringify(await (await post("en")).json());

      for (const forbidden of ["NEXT_REDIRECT", "digest", "/onboarding", "<!DOCTYPE", "<html"]) {
        expect(body).not.toContain(forbidden);
      }
    });

    it("localizes the message in English", async () => {
      expect((await (await post("en")).json()).error.message).toBe(
        "Please verify your email address before booking."
      );
    });

    it("localizes the message in Arabic while the code stays identical", async () => {
      const en = await (await post("en")).json();
      const ar = await (await post("ar")).json();

      expect(ar.error.message).toBe("يرجى تأكيد بريدك الإلكتروني قبل الحجز.");
      expect(ar.error.code).toBe(en.error.code);
      expect(ar.error.message).not.toBe(en.error.message);
    });

    it("creates nothing and never reads a booking back", async () => {
      await post("en");

      expect(getBookingDetail).not.toHaveBeenCalled();
    });
  });
});
