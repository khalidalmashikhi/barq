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
const getBookingTimelineMock = vi.fn();
vi.mock("@/lib/booking/get-booking-detail", () => ({ getBookingDetail: (...a: unknown[]) => getBookingDetailMock(...a) }));
vi.mock("@/lib/booking/lifecycle", () => ({ getBookingTimeline: (...a: unknown[]) => getBookingTimelineMock(...a) }));

const { GET } = await import("./route");

beforeEach(() => {
  h.requireAuth.mockReset();
  getBookingDetailMock.mockReset();
  getBookingTimelineMock.mockReset();
  h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://x/api/v1/me/bookings/b1/timeline?locale=en");

describe("GET /api/v1/me/bookings/{id}/timeline", () => {
  it("401 unauthenticated", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());
    const res = await GET(req(), params("b1"));
    expect(res.status).toBe(401);
    expect(getBookingTimelineMock).not.toHaveBeenCalled();
  });

  it("404 for another customer's / nonexistent booking (ownership via getBookingDetail; timeline never read)", async () => {
    getBookingDetailMock.mockResolvedValue(null);
    const res = await GET(req(), params("b1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(getBookingTimelineMock).not.toHaveBeenCalled();
  });

  it("200 returns own booking's timeline, ordering preserved, no actorId/internal ids", async () => {
    getBookingDetailMock.mockResolvedValue({ id: "b1" });
    getBookingTimelineMock.mockResolvedValue([
      { id: "e1", fromStatus: null, toStatus: "CREATED", actorType: "CUSTOMER", reason: null, occurredAt: new Date("2026-05-01T00:00:00.000Z") },
      { id: "e2", fromStatus: "CREATED", toStatus: "PENDING_PROVIDER", actorType: "SYSTEM", reason: null, occurredAt: new Date("2026-05-01T00:00:01.000Z") },
    ]);
    const res = await GET(req(), params("b1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(getBookingTimelineMock).toHaveBeenCalledWith("b1");
    const body = await res.json();
    expect(body.items).toEqual([
      { id: "e1", fromStatus: null, toStatus: "CREATED", actorType: "CUSTOMER", reason: null, occurredAt: "2026-05-01T00:00:00.000Z" },
      { id: "e2", fromStatus: "CREATED", toStatus: "PENDING_PROVIDER", actorType: "SYSTEM", reason: null, occurredAt: "2026-05-01T00:00:01.000Z" },
    ]);
    expect(JSON.stringify(body)).not.toContain("actorId");
    expect(JSON.stringify(body)).not.toContain("customerId");
  });
});
