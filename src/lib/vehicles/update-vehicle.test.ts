import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.length > 0 }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a),
  ForbiddenError: class ForbiddenError extends Error {},
}));

const assetFindFirstMock = vi.fn();
const assetUpdateManyMock = vi.fn();
const vehicleUpdateMock = vi.fn();
const auditCreateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: async (cb: (tx: unknown) => unknown) =>
      cb({
        asset: {
          findFirst: (...a: unknown[]) => assetFindFirstMock(...a),
          updateMany: (...a: unknown[]) => assetUpdateManyMock(...a),
        },
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
  assetUpdateManyMock.mockReset();
  vehicleUpdateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("updateVehicle — ownership enforcement", () => {
  it("updates the caller's own vehicle and audits before/after", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "DRAFT", vehicle: { make: "Toyota", model: "Corolla", modelYear: null, color: null, vehicleType: "SEDAN", bookablePassengerCapacity: 4, registeredSeats: null, publicDescription: null, registrationNumber: null } });
    vehicleUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateVehicle("asset-1", VALID);
    expect(result).toEqual({ ok: true });
    // Editing from an already-editable state never re-opens verification.
    expect(assetUpdateManyMock).not.toHaveBeenCalled();
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

// Phase 3C Slice B — a capacity change on a trusted/under-review vehicle re-opens verification.
describe("updateVehicle — capacity edit re-opens verification (safety)", () => {
  it("APPROVED vehicle + changed bookable capacity → resets verification to DRAFT (guarded), NEVER touches Asset.status", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    // before bookable = 4; VALID.passengerCapacity = 5 → changed.
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "APPROVED", vehicle: { make: "Toyota", model: "Corolla", modelYear: null, color: null, vehicleType: "SEDAN", bookablePassengerCapacity: 4, registeredSeats: null, publicDescription: null, registrationNumber: null } });
    vehicleUpdateMock.mockResolvedValue({});
    assetUpdateManyMock.mockResolvedValue({ count: 1 });
    auditCreateMock.mockResolvedValue({});

    const result = await updateVehicle("asset-1", VALID);
    expect(result).toEqual({ ok: true });

    // Reset is guarded on the trigger statuses and only writes the verification axis (no status).
    expect(assetUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "asset-1", verificationStatus: { in: ["SUBMITTED", "APPROVED"] } },
        data: expect.objectContaining({ verificationStatus: "DRAFT", verificationReviewedByAdminId: null }),
      }),
    );
    const resetData = assetUpdateManyMock.mock.calls[0]![0].data;
    expect("status" in resetData).toBe(false); // two-axis invariant: operational status untouched
    // A dedicated audit event records the reset.
    expect(auditCreateMock).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "vehicle.verification_reset_on_capacity_change" }) });
  });

  it("APPROVED vehicle + NO capacity change (only colour) → verification is NOT reset", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    // before bookable = 5 == VALID.passengerCapacity 5; registeredSeats null == null → no capacity change.
    assetFindFirstMock.mockResolvedValue({ id: "asset-1", verificationStatus: "APPROVED", vehicle: { make: "Toyota", model: "Hilux", modelYear: 2024, color: "Silver", vehicleType: "SUV", bookablePassengerCapacity: 5, registeredSeats: null, publicDescription: null, registrationNumber: null } });
    vehicleUpdateMock.mockResolvedValue({});
    auditCreateMock.mockResolvedValue({});

    const result = await updateVehicle("asset-1", VALID); // only color differs (null vs "Silver")
    expect(result).toEqual({ ok: true });
    expect(assetUpdateManyMock).not.toHaveBeenCalled();
  });
});
