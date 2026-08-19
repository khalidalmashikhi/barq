import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.length > 0 }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError: class ForbiddenError extends Error {},
}));

const assetFindFirstMock = vi.fn();
const vehicleUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        asset: { findFirst: (...a: unknown[]) => assetFindFirstMock(...a) },
        vehicle: { update: (...a: unknown[]) => vehicleUpdateMock(...a) },
        auditLog: { create: (...a: unknown[]) => auditCreateMock(...a) },
      }),
  },
}));

const { updateVehicle } = await import("./update-vehicle");

const VALID = { make: "Toyota", model: "Hilux", modelYear: 2024, color: null, vehicleType: "SUV", passengerCapacity: 5, publicDescription: null, registrationNumber: null };

afterEach(() => {
  requireApprovedProviderMock.mockReset();
  assetFindFirstMock.mockReset();
  vehicleUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateVehicle — ownership enforcement", () => {
  it("updates the caller's own vehicle and audits before/after", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", vehicle: { make: "Toyota", model: "Corolla", modelYear: null, color: null, vehicleType: "SEDAN", passengerCapacity: 4, publicDescription: null, registrationNumber: null } });
    vehicleUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateVehicle("asset-1", VALID);
    expect(result).toEqual({ ok: true });
    // Ownership scope present in the lookup.
    expect(assetFindFirstMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "asset-1", providerId: "prov-1", assetType: "VEHICLE" }) }));
    expect(vehicleUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ where: { assetId: "asset-1" } }));
    expect(auditCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "vehicle.updated" }) });
  });

  it("cannot update another provider's vehicle (scoped lookup misses → VEHICLE_NOT_FOUND, no write)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-2" } });
    assetFindFirstMock.mockResolvedValue(null); // not owned by prov-2

    const result = await updateVehicle("asset-1", VALID);
    expect(result).toEqual({ ok: false, error: "VEHICLE_NOT_FOUND" });
    expect(vehicleUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects invalid input (unknown key) without writing", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    const result = await updateVehicle("asset-1", { ...VALID, assetType: "VEHICLE" });
    expect(result).toEqual({ ok: false, error: "INVALID_INPUT" });
    expect(vehicleUpdateMock).not.toHaveBeenCalled();
  });
});
