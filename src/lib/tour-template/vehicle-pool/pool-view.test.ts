import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.startsWith("svc-") }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));

const loadContextMock = vi.fn();
vi.mock("./tour-service-context", () => ({ loadOwnedTourServiceContext: (...a: unknown[]) => loadContextMock(...a) }));

const poolFindManyMock = vi.fn();
const vehicleFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    tourServiceVehicle: { findMany: (...a: unknown[]) => poolFindManyMock(...a) },
    vehicle: { findMany: (...a: unknown[]) => vehicleFindManyMock(...a) },
  },
}));

const { getTourServiceVehiclePoolView } = await import("./pool-view");

const FUTURE = new Date("2027-01-01T00:00:00.000Z");

// A full, READY, transport-eligible vehicle row (ACTIVE + APPROVED + valid docs).
function vehicleRow(over: Record<string, unknown> = {}) {
  return {
    assetId: "veh-1",
    make: "Toyota",
    model: "Land Cruiser",
    modelYear: 2025,
    color: "White",
    vehicleType: "SUV",
    passengerCapacity: 6,
    publicDescription: null,
    registrationNumber: "OM 12345",
    claimedFourByFour: true,
    fourByFourVerified: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    asset: {
      status: "ACTIVE",
      providerId: "prov-1",
      verificationStatus: "APPROVED",
      documents: [
        { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: FUTURE },
        { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: FUTURE },
      ],
    },
    ...over,
  };
}

const ctx = (packageType: string, maxGuests: number | null = null) => ({
  ok: true,
  context: { serviceId: "svc-1", providerId: "prov-1", packageType, maxGuests },
});

afterEach(() => vi.clearAllMocks());

describe("getTourServiceVehiclePoolView", () => {
  it("null for a malformed id (never authenticates)", async () => {
    expect(await getTourServiceVehiclePoolView("bad")).toBeNull();
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("null for a foreign/missing/non-tour service", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    loadContextMock.mockResolvedValue({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(await getTourServiceVehiclePoolView("svc-1")).toBeNull();
  });

  it("GUIDE_ONLY: vehicleAllowed=false and never queries the fleet for candidates", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    loadContextMock.mockResolvedValue(ctx("GUIDE_ONLY"));
    poolFindManyMock.mockResolvedValue([]);

    const view = await getTourServiceVehiclePoolView("svc-1");
    expect(view?.vehicleAllowed).toBe(false);
    expect(view?.available).toEqual([]);
    expect(vehicleFindManyMock).not.toHaveBeenCalled();
  });

  it("transport: classifies pool + available, excludes pooled, in two batched queries; slim DTO leaks no plate/asset", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    loadContextMock.mockResolvedValue(ctx("GUIDE_WITH_TRANSPORT"));
    poolFindManyMock.mockResolvedValue([{ vehicle: vehicleRow({ assetId: "veh-1" }) }]);
    vehicleFindManyMock.mockResolvedValue([vehicleRow({ assetId: "veh-1" }), vehicleRow({ assetId: "veh-2" })]);

    const view = await getTourServiceVehiclePoolView("svc-1");
    expect(poolFindManyMock).toHaveBeenCalledTimes(1);
    expect(vehicleFindManyMock).toHaveBeenCalledTimes(1);

    // Pooled veh-1 is in the pool and excluded from available; veh-2 is a candidate.
    expect(view?.pool.map((v) => v.vehicleId)).toEqual(["veh-1"]);
    expect(view?.available.map((v) => v.vehicleId)).toEqual(["veh-2"]);
    expect(view?.pool[0]?.eligible).toBe(true);
    expect(view?.pool[0]?.isInPool).toBe(true);
    expect(view?.available[0]?.isInPool).toBe(false);

    // Privacy: the slim view carries no registrationNumber / asset / raw trusted flag.
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("OM 12345");
    expect(serialized).not.toContain("registrationNumber");
    expect(serialized).not.toContain("fourByFourVerified");
    expect(view?.pool[0]).not.toHaveProperty("asset");
    expect(view?.pool[0]?.isFourByFour).toBe(false); // trusted null → fail-closed
  });

  it("GUIDE_WITH_4X4: an unverified-4x4 vehicle is listed but ineligible", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    loadContextMock.mockResolvedValue(ctx("GUIDE_WITH_4X4"));
    poolFindManyMock.mockResolvedValue([]);
    vehicleFindManyMock.mockResolvedValue([vehicleRow({ assetId: "veh-2", fourByFourVerified: null })]);

    const view = await getTourServiceVehiclePoolView("svc-1");
    expect(view?.requiresFourByFour).toBe(true);
    expect(view?.available[0]?.eligible).toBe(false);
    expect(view?.available[0]?.blockers).toContain("NOT_FOUR_BY_FOUR_CAPABLE");
  });
});
