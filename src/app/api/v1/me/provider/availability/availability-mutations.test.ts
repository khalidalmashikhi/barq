import { describe, it, expect, beforeEach, vi } from "vitest";

// Auth-gate + code→status mapping covered in the provider-mutation-* unit tests.
// These prove the WIRING for availability mutations: JSON body → FormData, the URL
// slot id passed straight to the ownership-scoped action (uniform SLOT_NOT_FOUND →
// 404 for a not-owned slot), and the domain safeguards surfaced faithfully.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));
vi.mock("@/lib/auth", () => ({ requireProvider: vi.fn().mockResolvedValue({ provider: { id: "p1" } }) }));

const createMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const listMock = vi.fn();
vi.mock("@/lib/provider/create-availability-slot", () => ({ createAvailabilitySlot: (...a: unknown[]) => createMock(...a) }));
vi.mock("@/lib/provider/update-availability-slot", () => ({ updateAvailabilitySlot: (...a: unknown[]) => updateMock(...a) }));
vi.mock("@/lib/provider/delete-availability-slot", () => ({ deleteAvailabilitySlot: (...a: unknown[]) => deleteMock(...a) }));
vi.mock("@/lib/provider/queries/get-provider-availability", () => ({
  getProviderAvailability: (...a: unknown[]) => listMock(...a),
}));

const { POST: createPOST } = await import("./route");
const { PATCH: updatePATCH, DELETE: deleteDELETE } = await import("./[id]/route");

const params = (id = "slot1") => ({ params: Promise.resolve({ id }) });
const req = (path: string, body?: unknown, method = "POST") =>
  new Request(`http://x/api/v1/me/provider/availability${path}?locale=en`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  createMock.mockReset();
  updateMock.mockReset();
  deleteMock.mockReset();
});

describe("POST /api/v1/me/provider/availability (create)", () => {
  it("201 { ok: true } → builds FormData (serviceId/startTime/endTime/capacity) for the domain action", async () => {
    createMock.mockResolvedValue({ ok: true });
    const res = await createPOST(
      req("", { serviceId: "s1", startTime: "2026-09-01T09:00:00.000Z", endTime: "2026-09-01T11:00:00.000Z", capacity: 4 })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const fd = createMock.mock.calls[0]![0] as FormData;
    expect(fd.get("serviceId")).toBe("s1");
    expect(fd.get("startTime")).toBe("2026-09-01T09:00:00.000Z");
    expect(fd.get("endTime")).toBe("2026-09-01T11:00:00.000Z");
    // numeric capacity is stringified into the FormData
    expect(fd.get("capacity")).toBe("4");
  });

  it("404 NOT_FOUND when the target service isn't the caller's own (uniform)", async () => {
    createMock.mockResolvedValue({ ok: false, error: "SERVICE_NOT_FOUND" });
    const res = await createPOST(req("", { serviceId: "not-mine", capacity: 1 }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("PATCH /api/v1/me/provider/availability/{id} (update)", () => {
  it("409 CAPACITY_BELOW_BOOKED, passing the URL slot id straight through", async () => {
    updateMock.mockResolvedValue({ ok: false, error: "CAPACITY_BELOW_BOOKED" });
    const res = await updatePATCH(req("/slot1", { capacity: 1 }, "PATCH"), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CAPACITY_BELOW_BOOKED");
    expect(updateMock.mock.calls[0]![0]).toBe("slot1");
    expect(updateMock.mock.calls[0]![1]).toBeInstanceOf(FormData);
  });

  it("404 NOT_FOUND for a not-owned slot (IDOR-safe)", async () => {
    updateMock.mockResolvedValue({ ok: false, error: "SLOT_NOT_FOUND" });
    const res = await updatePATCH(req("/other", { capacity: 2 }, "PATCH"), params("other"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("200 { ok: true } on success", async () => {
    updateMock.mockResolvedValue({ ok: true });
    const res = await updatePATCH(req("/slot1", { capacity: 5 }, "PATCH"), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("DELETE /api/v1/me/provider/availability/{id}", () => {
  it("409 SLOT_HAS_BOOKINGS when the slot still holds seats", async () => {
    deleteMock.mockResolvedValue({ ok: false, error: "SLOT_HAS_BOOKINGS" });
    const res = await deleteDELETE(req("/slot1", undefined, "DELETE"), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("SLOT_HAS_BOOKINGS");
    expect(deleteMock).toHaveBeenCalledWith("slot1");
  });

  it("404 NOT_FOUND for a not-owned slot", async () => {
    deleteMock.mockResolvedValue({ ok: false, error: "SLOT_NOT_FOUND" });
    const res = await deleteDELETE(req("/other", undefined, "DELETE"), params("other"));
    expect(res.status).toBe(404);
  });

  it("200 { ok: true } on success", async () => {
    deleteMock.mockResolvedValue({ ok: true });
    const res = await deleteDELETE(req("/slot1", undefined, "DELETE"), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
