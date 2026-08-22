import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/observability/with-request-tracing", () => ({
  withRequestTracing: (_n: string, handler: () => Promise<Response>) => handler(),
}));

const requireProviderMock = vi.fn();
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireProvider: (...a: unknown[]) => requireProviderMock(...a),
}));

const getViewMock = vi.fn();
const removeMock = vi.fn();
vi.mock("@/lib/tour-template/vehicle-pool/pool-view", () => ({ getTourServiceVehiclePoolView: (...a: unknown[]) => getViewMock(...a) }));
vi.mock("@/lib/tour-template/vehicle-pool/remove-vehicle-from-tour-service-pool", () => ({
  removeVehicleFromTourServicePool: (...a: unknown[]) => removeMock(...a),
}));

const { DELETE } = await import("./route");

const params = (id: string, vehicleId: string) => ({ params: Promise.resolve({ id, vehicleId }) });
const VIEW = { packageType: "GUIDE_WITH_TRANSPORT", vehicleAllowed: true, requiresFourByFour: false, maxGuests: null, pool: [], available: [] };
const req = () => new Request("http://x/api/v1/me/provider/services/s1/vehicle-pool/veh-1?locale=en", { method: "DELETE" });

beforeEach(() => {
  requireProviderMock.mockReset();
  getViewMock.mockReset();
  removeMock.mockReset();
});

describe("DELETE /api/v1/me/provider/services/{id}/vehicle-pool/{vehicleId}", () => {
  it("200 removes the vehicle and returns the updated view", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    removeMock.mockResolvedValue({ ok: true });
    getViewMock.mockResolvedValue(VIEW);
    const res = await DELETE(req(), params("s1", "veh-1"));
    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith("s1", "veh-1");
    expect(await res.json()).toEqual(VIEW);
  });

  it("idempotent: removing an absent row still succeeds", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    removeMock.mockResolvedValue({ ok: true });
    getViewMock.mockResolvedValue(VIEW);
    const res = await DELETE(req(), params("s1", "veh-9"));
    expect(res.status).toBe(200);
  });

  it("404 uniform for a foreign/missing service", async () => {
    requireProviderMock.mockResolvedValue({ provider: { id: "p1" } });
    removeMock.mockResolvedValue({ ok: false, error: "SERVICE_NOT_FOUND" });
    const res = await DELETE(req(), params("s1", "veh-1"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("401 when unauthenticated — the remove action never runs", async () => {
    const { UnauthenticatedError } = await import("@/lib/auth");
    requireProviderMock.mockRejectedValue(new (UnauthenticatedError as new () => Error)());
    const res = await DELETE(req(), params("s1", "veh-1"));
    expect(res.status).toBe(401);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
