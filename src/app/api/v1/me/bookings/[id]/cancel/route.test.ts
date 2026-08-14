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

const cancelBookingMock = vi.fn();
vi.mock("@/lib/booking/cancel-booking", () => ({ cancelBooking: (...a: unknown[]) => cancelBookingMock(...a) }));

const { POST } = await import("./route");

beforeEach(() => {
  h.requireAuth.mockReset();
  cancelBookingMock.mockReset();
  h.requireAuth.mockResolvedValue({ authUserId: "au1", barqUser: { id: "u1" } });
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://x/api/v1/me/bookings/b1/cancel?locale=en", { method: "POST" });

describe("POST /api/v1/me/bookings/{id}/cancel", () => {
  it("401 unauthenticated (cancelBooking never called)", async () => {
    h.requireAuth.mockRejectedValue(new h.UnauthenticatedError());
    const res = await POST(req(), params("b1"));
    expect(res.status).toBe(401);
    expect(cancelBookingMock).not.toHaveBeenCalled();
  });

  it("404 for another customer's / nonexistent booking (BOOKING_NOT_FOUND, anti-enumeration)", async () => {
    cancelBookingMock.mockResolvedValue({ ok: false, error: "BOOKING_NOT_FOUND" });
    const res = await POST(req(), params("b1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("422 BOOKING_NOT_CANCELLABLE for a non-cancellable state", async () => {
    cancelBookingMock.mockResolvedValue({ ok: false, error: "BOOKING_NOT_CANCELLABLE" });
    const res = await POST(req(), params("b1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("BOOKING_NOT_CANCELLABLE");
  });

  it("200 { ok: true } on a valid cancellation — delegates to the authoritative cancelBooking", async () => {
    cancelBookingMock.mockResolvedValue({ ok: true });
    const res = await POST(req(), params("b1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(cancelBookingMock).toHaveBeenCalledWith("b1");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("double cancellation is rejected per current semantics (second call not cancellable)", async () => {
    cancelBookingMock.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: "BOOKING_NOT_CANCELLABLE" });
    expect((await POST(req(), params("b1"))).status).toBe(200);
    expect((await POST(req(), params("b1"))).status).toBe(422);
  });
});
