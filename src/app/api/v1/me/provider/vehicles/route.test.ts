import { describe, it, expect, beforeEach, vi } from "vitest";
import { UnauthenticatedError } from "@/lib/auth/errors";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

// The mutation gate (withApiV1ProviderMutation) pre-authenticates with the real
// requireProvider() from @/lib/auth — mock only that. providerAuthErrorResponse
// matches instanceof against @/lib/auth/errors (a different module, left real).
const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireProvider: (...a: unknown[]) => requireProviderMock(...a) }));

const getProviderVehiclesMock = vi.fn();
const getProviderVehicleMock = vi.fn();
const createVehicleMock = vi.fn();
vi.mock("@/lib/vehicles/queries/get-provider-vehicles", () => ({ getProviderVehicles: (...a: unknown[]) => getProviderVehiclesMock(...a) }));
vi.mock("@/lib/vehicles/queries/get-provider-vehicle", () => ({ getProviderVehicle: (...a: unknown[]) => getProviderVehicleMock(...a) }));
vi.mock("@/lib/vehicles/create-vehicle", () => ({ createVehicle: (...a: unknown[]) => createVehicleMock(...a) }));

const { GET, POST } = await import("./route");

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

function postReq(body: unknown) {
  return new Request("http://x/api/v1/me/provider/vehicles?locale=en", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  requireProviderMock.mockReset();
  getProviderVehiclesMock.mockReset();
  getProviderVehicleMock.mockReset();
  createVehicleMock.mockReset();
});

describe("GET /api/v1/me/provider/vehicles", () => {
  it("200 lists the caller's vehicles as private DTOs (ISO dates, registration present), no-store", async () => {
    getProviderVehiclesMock.mockResolvedValue([dtoRow]);
    const res = await GET(new Request("http://x/api/v1/me/provider/vehicles?locale=en"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.items[0]).toEqual({
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
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    // No raw Prisma leakage.
    expect(JSON.stringify(body)).not.toContain("objectKey");
    expect(JSON.stringify(body)).not.toContain("descriptiveDetails");
    expect(JSON.stringify(body)).not.toContain("providerId");
  });

  it("401 when unauthenticated (reader throws UnauthenticatedError → mapped envelope)", async () => {
    getProviderVehiclesMock.mockRejectedValue(new UnauthenticatedError());
    const res = await GET(new Request("http://x/api/v1/me/provider/vehicles"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/v1/me/provider/vehicles", () => {
  it("201 creates and returns the private DTO", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "p1" } });
    createVehicleMock.mockResolvedValue({ ok: true, vehicleId: "veh-1" });
    getProviderVehicleMock.mockResolvedValue(dtoRow);
    const res = await POST(postReq({ make: "Toyota", model: "Land Cruiser", vehicleType: "FOUR_BY_FOUR", passengerCapacity: 6 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("veh-1");
    expect(body.registrationNumber).toBe("OM 12345"); // private DTO may carry it
  });

  it("forwards ONLY the allowlisted fields — client cannot supply providerId/assetType/status", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "p1" } });
    createVehicleMock.mockResolvedValue({ ok: true, vehicleId: "veh-1" });
    getProviderVehicleMock.mockResolvedValue(dtoRow);
    await POST(
      postReq({
        make: "Toyota",
        model: "Hilux",
        vehicleType: "SUV",
        passengerCapacity: 5,
        providerId: "attacker",
        assetType: "SOMETHING",
        status: "ACTIVE",
        id: "forged",
      }),
    );
    const arg = createVehicleMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(
      ["claimedFourByFour", "color", "make", "model", "modelYear", "passengerCapacity", "publicDescription", "registrationNumber", "vehicleType"].sort(),
    );
    expect(arg.providerId).toBeUndefined();
    expect(arg.assetType).toBeUndefined();
    expect(arg.status).toBeUndefined();
    expect(arg.id).toBeUndefined();
  });

  it("409 DUPLICATE_REGISTRATION for a duplicate plate (never reveals the owner)", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "p1" } });
    createVehicleMock.mockResolvedValue({ ok: false, error: "DUPLICATE_REGISTRATION" });
    const res = await POST(postReq({ make: "Toyota", model: "Hilux", vehicleType: "SUV", passengerCapacity: 5, registrationNumber: "OM 1" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("DUPLICATE_REGISTRATION");
    expect(JSON.stringify(body)).not.toContain("p1"); // no provider id leaked
  });

  it("400 INVALID_INPUT for a bad payload", async () => {
    requireProviderMock.mockResolvedValue({ barqUser: { id: "u1" }, provider: { id: "p1" } });
    createVehicleMock.mockResolvedValue({ ok: false, error: "INVALID_INPUT" });
    const res = await POST(postReq({ make: "" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("401 when unauthenticated (mutation pre-auth blocks before the action runs)", async () => {
    requireProviderMock.mockRejectedValue(new UnauthenticatedError());
    const res = await POST(postReq({ make: "Toyota", model: "Hilux", vehicleType: "SUV", passengerCapacity: 5 }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(createVehicleMock).not.toHaveBeenCalled();
  });
});
