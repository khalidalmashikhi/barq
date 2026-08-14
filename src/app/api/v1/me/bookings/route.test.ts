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

const { GET } = await import("./route");

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
          serviceName: "Desert Safari",
          status: "CONFIRMED",
          priceSnapshot: "25 OMR",
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
    expect(body.items[0]).toEqual({
      id: "b1",
      status: "CONFIRMED",
      serviceName: "Desert Safari",
      priceSnapshot: { amount: "25.00", currency: "OMR" },
      scheduledStartTime: "2026-06-01T09:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    expect(typeof body.items[0].priceSnapshot.amount).toBe("string");
    expect(body).toMatchObject({ page: 1, pageSize: 50, totalCount: 1, totalPages: 1 });
  });
});
