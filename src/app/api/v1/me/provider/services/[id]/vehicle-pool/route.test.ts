import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

// The mutation gate pre-authenticates with the real requireProvider() from @/lib/auth —
// mock only that. providerAuthErrorResponse matches instanceof against the same module's
// error classes, so they must be provided here too.
const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
}));

const getViewMock = vi.fn();
const addMock = vi.fn();
vi.mock("@/lib/tour-template/vehicle-pool/pool-view", () => ({ getTourServiceVehiclePoolView: (...a: unknown[]) => getViewMock(...a) }));
vi.mock("@/lib/tour-template/vehicle-pool/add-vehicle-to-tour-service-pool", () => ({
  addVehicleToTourServicePool: (...a: unknown[]) => addMock(...a),
}));

const { GET, POST } = await import("./route");

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const VIEW = { packageType: "GUIDE_WITH_TRANSPORT", vehicleAllowed: true, requiresFourByFour: false, maxGuests: null, pool: [], available: [] };

function postReq(body: unknown) {
  return new Request("http://x/api/v1/me/provider/services/s1/vehicle-pool?locale=en", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireProviderMock.mockReset();
  getViewMock.mockReset();
  addMock.mockReset();
});

describe("GET /api/v1/me/provider/services/{id}/vehicle-pool", () => {
  it("200 returns the pool view (reader scoped to the caller)", async () => {
    getViewMock.mockResolvedValue(VIEW);
    const res = await GET(new Request("http://x/...?locale=en"), params("s1"));
    expect(res.status).toBe(200);
    expect(getViewMock).toHaveBeenCalledWith("s1");
    expect(await res.json()).toEqual(VIEW);
  });

  it("404 uniform when the reader returns null (missing/foreign/non-tour)", async () => {
    getViewMock.mockResolvedValue(null);
    const res = await GET(new Request("http://x/...?locale=en"), params("s1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("401 when the reader throws UnauthenticatedError", async () => {
    const { UnauthenticatedError } = await import("@/lib/auth");
    getViewMock.mockRejectedValue(new (UnauthenticatedError as new () => Error)());
    const res = await GET(new Request("http://x/...?locale=en"), params("s1"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/v1/me/provider/services/{id}/vehicle-pool", () => {
  it("201 adds an eligible vehicle and returns the updated view", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    addMock.mockResolvedValue({ ok: true });
    getViewMock.mockResolvedValue(VIEW);
    const res = await POST(postReq({ vehicleId: "veh-1" }), params("s1"));
    expect(res.status).toBe(201);
    expect(addMock).toHaveBeenCalledWith("s1", "veh-1");
    expect(await res.json()).toEqual(VIEW);
  });

  it("idempotent: a duplicate add still succeeds (domain returns ok)", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    addMock.mockResolvedValue({ ok: true });
    getViewMock.mockResolvedValue(VIEW);
    const res = await POST(postReq({ vehicleId: "veh-1" }), params("s1"));
    expect(res.status).toBe(201);
  });

  it("422 TOUR_VEHICLE_NOT_ELIGIBLE when the vehicle is not assignable", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    addMock.mockResolvedValue({ ok: false, error: "VEHICLE_NOT_ELIGIBLE" });
    const res = await POST(postReq({ vehicleId: "veh-1" }), params("s1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("TOUR_VEHICLE_NOT_ELIGIBLE");
  });

  it("404 uniform for a foreign/missing vehicle", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    addMock.mockResolvedValue({ ok: false, error: "VEHICLE_NOT_FOUND" });
    const res = await POST(postReq({ vehicleId: "veh-x" }), params("s1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("400 INVALID_INPUT for a bad vehicle id", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    addMock.mockResolvedValue({ ok: false, error: "INVALID_INPUT" });
    const res = await POST(postReq({ vehicleId: "" }), params("s1"));
    expect(res.status).toBe(400);
  });

  it("401 when unauthenticated — the add action never runs", async () => {
    const { UnauthenticatedError } = await import("@/lib/auth");
    requireProviderMock.mockRejectedValue(new (UnauthenticatedError as new () => Error)());
    const res = await POST(postReq({ vehicleId: "veh-1" }), params("s1"));
    expect(res.status).toBe(401);
    expect(addMock).not.toHaveBeenCalled();
  });
});
