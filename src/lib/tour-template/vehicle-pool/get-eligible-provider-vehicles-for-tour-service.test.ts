import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.startsWith("svc-") }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));

const loadContextMock = vi.fn();
vi.mock("./tour-service-context", () => ({ loadOwnedTourServiceContext: (...a: unknown[]) => loadContextMock(...a) }));

const evaluateMock = vi.fn();
vi.mock("./pool-dto", () => ({ POOL_ASSET_SELECT: {}, evaluatePoolVehicle: (...a: unknown[]) => evaluateMock(...a) }));

const vehicleFindManyMock = vi.fn();
const poolFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    vehicle: { findMany: (...a: unknown[]) => vehicleFindManyMock(...a) },
    tourServiceVehicle: { findMany: (...a: unknown[]) => poolFindManyMock(...a) },
  },
}));

const { getEligibleProviderVehiclesForTourService } = await import("./get-eligible-provider-vehicles-for-tour-service");

const ctx = (packageType: string) => ({ ok: true, context: { serviceId: "svc-1", providerId: "prov-1", packageType, maxGuests: null } });

afterEach(() => vi.clearAllMocks());

describe("getEligibleProviderVehiclesForTourService", () => {
  it("null for malformed id / foreign service", async () => {
    expect(await getEligibleProviderVehiclesForTourService("bad")).toBeNull();
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    loadContextMock.mockResolvedValue({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(await getEligibleProviderVehiclesForTourService("svc-1")).toBeNull();
  });

  it("GUIDE_ONLY has no candidates => [] (never queries vehicles)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    loadContextMock.mockResolvedValue(ctx("GUIDE_ONLY"));
    expect(await getEligibleProviderVehiclesForTourService("svc-1")).toEqual([]);
    expect(vehicleFindManyMock).not.toHaveBeenCalled();
  });

  it("excludes already-pooled vehicles and classifies the rest, in bounded queries (no N+1)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    loadContextMock.mockResolvedValue(ctx("GUIDE_WITH_TRANSPORT"));
    vehicleFindManyMock.mockResolvedValue([{ assetId: "veh-1" }, { assetId: "veh-2" }, { assetId: "veh-3" }]);
    poolFindManyMock.mockResolvedValue([{ vehicleId: "veh-2" }]); // veh-2 already pooled
    evaluateMock.mockImplementation((v: { assetId: string }) => ({ vehicle: { id: v.assetId }, eligible: true, blockers: [] }));

    const out = await getEligibleProviderVehiclesForTourService("svc-1");
    expect(vehicleFindManyMock).toHaveBeenCalledTimes(1);
    expect(poolFindManyMock).toHaveBeenCalledTimes(1);
    expect(out).toEqual([
      { vehicle: { id: "veh-1" }, eligible: true, blockers: [] },
      { vehicle: { id: "veh-3" }, eligible: true, blockers: [] },
    ]);
    // veh-2 (pooled) is excluded from the "available to add" list.
    expect(evaluateMock).toHaveBeenCalledTimes(2);
  });
});
