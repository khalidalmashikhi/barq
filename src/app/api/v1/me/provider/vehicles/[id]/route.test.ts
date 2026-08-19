import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnauthenticatedError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireProvider: (...a: unknown[]) => requireProviderMock(...a) }));

const getProviderVehicleMock = vi.fn();
const updateVehicleMock = vi.fn();
vi.mock("@/lib/vehicles/queries/get-provider-vehicle", () => ({ getProviderVehicle: (...a: unknown[]) => getProviderVehicleMock(...a) }));
vi.mock("@/lib/vehicles/update-vehicle", () => ({ updateVehicle: (...a: unknown[]) => updateVehicleMock(...a) }));

const routeModule = await import("./route");
const { GET, PATCH } = routeModule;

const dtoRow = {
  id: "veh-1",
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR",
  passengerCapacity: 6,
  publicDescription: null,
  registrationNumber: "OM 12345",
  status: "REGISTERED",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const params = (id: string) => ({ params: Promise.resolve({ id }) });
function patchReq(body: unknown) {
  return new Request("http://x/api/v1/me/provider/vehicles/veh-1?locale=en", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireProviderMock.mockReset();
  getProviderVehicleMock.mockReset();
  updateVehicleMock.mockReset();
});

describe("GET /api/v1/me/provider/vehicles/{id}", () => {
  it("200 returns the caller's own vehicle (private DTO)", async () => {
    getProviderVehicleMock.mockResolvedValue(dtoRow);
    const res = await GET(new Request("http://x/api/v1/me/provider/vehicles/veh-1?locale=en"), params("veh-1"));
    expect(res.status).toBe(200);
    expect(getProviderVehicleMock).toHaveBeenCalledWith("veh-1");
    expect((await res.json()).registrationNumber).toBe("OM 12345");
  });

  it("404 uniform for invalid/missing/foreign vehicle (reader null → not enumerable)", async () => {
    getProviderVehicleMock.mockResolvedValue(null);
    const res = await GET(new Request("http://x/api/v1/me/provider/vehicles/foreign?locale=en"), params("foreign"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("PATCH /api/v1/me/provider/vehicles/{id}", () => {
  it("200 updates and returns the private DTO", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "p1" } });
    updateVehicleMock.mockResolvedValue({ ok: true });
    getProviderVehicleMock.mockResolvedValue(dtoRow);
    const res = await PATCH(patchReq({ make: "Toyota", model: "Prado", vehicleType: "FOUR_BY_FOUR", passengerCapacity: 7 }), params("veh-1"));
    expect(res.status).toBe(200);
    expect(updateVehicleMock).toHaveBeenCalledWith("veh-1", expect.objectContaining({ make: "Toyota", passengerCapacity: 7 }));
  });

  it("forwards ONLY allowlisted fields — status/providerId/assetType/verification cannot be mutated via PATCH", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "p1" } });
    updateVehicleMock.mockResolvedValue({ ok: true });
    getProviderVehicleMock.mockResolvedValue(dtoRow);
    await PATCH(
      patchReq({ make: "Toyota", model: "Prado", vehicleType: "SUV", passengerCapacity: 7, status: "ACTIVE", providerId: "x", assetType: "y", verificationStatus: "APPROVED" }),
      params("veh-1"),
    );
    const arg = updateVehicleMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(arg.status).toBeUndefined();
    expect(arg.providerId).toBeUndefined();
    expect(arg.assetType).toBeUndefined();
    expect(arg.verificationStatus).toBeUndefined();
    expect(Object.keys(arg).sort()).toEqual(
      ["color", "make", "model", "modelYear", "passengerCapacity", "publicDescription", "registrationNumber", "vehicleType"].sort(),
    );
  });

  it("404 for a foreign/missing vehicle (VEHICLE_NOT_FOUND → uniform NOT_FOUND)", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "p1" } });
    updateVehicleMock.mockResolvedValue({ ok: false, error: "VEHICLE_NOT_FOUND" });
    const res = await PATCH(patchReq({ make: "T", model: "M", vehicleType: "SUV", passengerCapacity: 4 }), params("veh-1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("409 DUPLICATE_REGISTRATION on a conflicting plate update", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "p1" } });
    updateVehicleMock.mockResolvedValue({ ok: false, error: "DUPLICATE_REGISTRATION" });
    const res = await PATCH(patchReq({ make: "T", model: "M", vehicleType: "SUV", passengerCapacity: 4, registrationNumber: "OM 1" }), params("veh-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("DUPLICATE_REGISTRATION");
  });
});

describe("no status-lifecycle endpoint (VEHICLE-1B)", () => {
  it("exposes only GET + PATCH (no PUT/DELETE/status handler)", () => {
    expect(typeof routeModule.GET).toBe("function");
    expect(typeof routeModule.PATCH).toBe("function");
    expect((routeModule as Record<string, unknown>).PUT).toBeUndefined();
    expect((routeModule as Record<string, unknown>).DELETE).toBeUndefined();
    expect((routeModule as Record<string, unknown>).POST).toBeUndefined();
  });
});
