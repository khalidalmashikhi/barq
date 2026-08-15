import { describe, it, expect, beforeEach, vi } from "vitest";

// Auth-gate mapping is covered authoritatively in
// src/lib/api/v1/provider-mutation-auth.test.ts; the code→status mapping in
// src/lib/api/v1/provider-mutation-errors.test.ts. These route tests prove the
// WIRING: the URL id (never a client-supplied providerId) is passed straight to
// the ownership-scoped domain action, success re-reads via the scoped reader and
// returns the detail DTO, and a not-owned booking → uniform 404.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
// Pre-auth passes (a valid provider session) for every case here.
vi.mock("@/lib/auth", () => ({ requireProvider: vi.fn().mockResolvedValue({ provider: { id: "p1" } }) }));

const acceptMock = vi.fn();
const rejectMock = vi.fn();
const startMock = vi.fn();
const completeMock = vi.fn();
const detailMock = vi.fn();
vi.mock("@/lib/booking/accept-booking", () => ({ acceptBooking: (...a: unknown[]) => acceptMock(...a) }));
vi.mock("@/lib/booking/reject-booking", () => ({ rejectBooking: (...a: unknown[]) => rejectMock(...a) }));
vi.mock("@/lib/booking/start-booking", () => ({ startBooking: (...a: unknown[]) => startMock(...a) }));
vi.mock("@/lib/booking/complete-booking", () => ({ completeBooking: (...a: unknown[]) => completeMock(...a) }));
vi.mock("@/lib/provider/queries/get-provider-booking-detail", () => ({
  getProviderBookingDetail: (...a: unknown[]) => detailMock(...a),
}));

const { POST: acceptPOST } = await import("./accept/route");
const { POST: rejectPOST } = await import("./reject/route");
const { POST: startPOST } = await import("./start/route");
const { POST: completePOST } = await import("./complete/route");

const params = (id = "b1") => ({ params: Promise.resolve({ id }) });
const post = (body?: unknown) =>
  new Request("http://x/api/v1/me/provider/bookings/b1/accept?locale=en", {
    method: "POST",
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const DETAIL = {
  id: "b1",
  serviceId: "s1",
  serviceName: "Safari",
  status: "CONFIRMED",
  seats: 2,
  priceSnapshot: "25 OMR",
  slotStartTime: new Date("2026-06-01T09:00:00.000Z"),
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
};

beforeEach(() => {
  acceptMock.mockReset();
  rejectMock.mockReset();
  startMock.mockReset();
  completeMock.mockReset();
  detailMock.mockReset();
});

describe("POST /api/v1/me/provider/bookings/{id}/accept", () => {
  it("200 → calls acceptBooking(id) with the URL id ONLY, re-reads, returns the detail DTO (no PII)", async () => {
    acceptMock.mockResolvedValue({ ok: true });
    detailMock.mockResolvedValue(DETAIL);
    const res = await acceptPOST(post(), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // IDOR: the only argument is the id from the URL — no client providerId path exists.
    expect(acceptMock).toHaveBeenCalledWith("b1");
    expect(detailMock).toHaveBeenCalledWith("b1", "en");
    const body = await res.json();
    expect(body).toEqual({
      id: "b1",
      serviceId: "s1",
      serviceName: "Safari",
      status: "CONFIRMED",
      seats: 2,
      priceSnapshot: { amount: "25.00", currency: "OMR" },
      scheduledStartTime: "2026-06-01T09:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    const s = JSON.stringify(body);
    expect(s).not.toContain("customerId");
    expect(s).not.toContain("phone");
  });

  it("404 NOT_FOUND for a missing/not-owned booking, and NEVER re-reads (uniform, anti-enumeration)", async () => {
    acceptMock.mockResolvedValue({ ok: false, error: "BOOKING_NOT_FOUND" });
    const res = await acceptPOST(post(), params("someone-elses-id"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
    expect(acceptMock).toHaveBeenCalledWith("someone-elses-id");
    expect(detailMock).not.toHaveBeenCalled();
  });

  it("409 BOOKING_NOT_ACTIONABLE when the booking isn't PENDING_PROVIDER", async () => {
    acceptMock.mockResolvedValue({ ok: false, error: "BOOKING_NOT_PENDING" });
    const res = await acceptPOST(post(), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("BOOKING_NOT_ACTIONABLE");
  });
});

describe("POST /api/v1/me/provider/bookings/{id}/reject", () => {
  it("passes an optional reason through verbatim; success returns the detail DTO", async () => {
    rejectMock.mockResolvedValue({ ok: true });
    detailMock.mockResolvedValue({ ...DETAIL, status: "REJECTED_PROVIDER" });
    const res = await rejectPOST(post({ reason: "fully booked" }), params());
    expect(res.status).toBe(200);
    expect(rejectMock).toHaveBeenCalledWith("b1", "fully booked");
    expect((await res.json()).status).toBe("REJECTED_PROVIDER");
  });

  it("omits reason (undefined) when the body has none", async () => {
    rejectMock.mockResolvedValue({ ok: true });
    detailMock.mockResolvedValue({ ...DETAIL, status: "REJECTED_PROVIDER" });
    await rejectPOST(post(), params());
    expect(rejectMock).toHaveBeenCalledWith("b1", undefined);
  });

  it("409 BOOKING_NOT_ACTIONABLE when not rejectable", async () => {
    rejectMock.mockResolvedValue({ ok: false, error: "BOOKING_NOT_PENDING" });
    const res = await rejectPOST(post(), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("BOOKING_NOT_ACTIONABLE");
  });
});

describe("POST /api/v1/me/provider/bookings/{id}/start", () => {
  it("200 on success via startBooking(id)", async () => {
    startMock.mockResolvedValue({ ok: true });
    detailMock.mockResolvedValue({ ...DETAIL, status: "IN_PROGRESS" });
    const res = await startPOST(post(), params());
    expect(res.status).toBe(200);
    expect(startMock).toHaveBeenCalledWith("b1");
    expect((await res.json()).status).toBe("IN_PROGRESS");
  });

  it("409 BOOKING_NOT_ACTIONABLE when not startable", async () => {
    startMock.mockResolvedValue({ ok: false, error: "BOOKING_NOT_STARTABLE" });
    const res = await startPOST(post(), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("BOOKING_NOT_ACTIONABLE");
  });

  it("404 NOT_FOUND for a not-owned booking", async () => {
    startMock.mockResolvedValue({ ok: false, error: "BOOKING_NOT_FOUND" });
    const res = await startPOST(post(), params("x"));
    expect(res.status).toBe(404);
    expect(detailMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/me/provider/bookings/{id}/complete", () => {
  it("200 on success via completeBooking(id)", async () => {
    completeMock.mockResolvedValue({ ok: true });
    detailMock.mockResolvedValue({ ...DETAIL, status: "COMPLETED" });
    const res = await completePOST(post(), params());
    expect(res.status).toBe(200);
    expect(completeMock).toHaveBeenCalledWith("b1");
    expect((await res.json()).status).toBe("COMPLETED");
  });

  it("409 BOOKING_NOT_ACTIONABLE when not completable", async () => {
    completeMock.mockResolvedValue({ ok: false, error: "BOOKING_NOT_COMPLETABLE" });
    const res = await completePOST(post(), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("BOOKING_NOT_ACTIONABLE");
  });
});
