import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.startsWith("svc-") }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));

const loadContextMock = vi.fn();
vi.mock("./tour-service-context", () => ({ loadOwnedTourServiceContext: (...a: unknown[]) => loadContextMock(...a) }));

const evaluateMock = vi.fn();
vi.mock("./pool-dto", () => ({ POOL_ASSET_SELECT: {}, evaluatePoolVehicle: (...a: unknown[]) => evaluateMock(...a) }));

const poolFindManyMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { tourServiceVehicle: { findMany: (...a: unknown[]) => poolFindManyMock(...a) } } }));

const { getTourServiceVehiclePool } = await import("./get-tour-service-vehicle-pool");

afterEach(() => vi.clearAllMocks());

describe("getTourServiceVehiclePool", () => {
  it("null for a malformed serviceId (never authenticates)", async () => {
    expect(await getTourServiceVehiclePool("bad")).toBeNull();
    expect(requireApprovedProviderMock).not.toHaveBeenCalled();
  });

  it("null when the service is foreign/missing/non-tour (uniform, no enumeration)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    loadContextMock.mockResolvedValue({ ok: false, error: "SERVICE_NOT_FOUND" });
    expect(await getTourServiceVehiclePool("svc-1")).toBeNull();
    expect(poolFindManyMock).not.toHaveBeenCalled();
  });

  it("returns each pooled vehicle with addedAt + live eligibility, in ONE query (no N+1)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    loadContextMock.mockResolvedValue({ ok: true, context: { serviceId: "svc-1", providerId: "prov-1", packageType: "GUIDE_WITH_TRANSPORT", maxGuests: null } });
    poolFindManyMock.mockResolvedValue([
      { createdAt: new Date("2026-02-01T00:00:00Z"), vehicle: { assetId: "veh-1" } },
      { createdAt: new Date("2026-03-01T00:00:00Z"), vehicle: { assetId: "veh-2" } },
    ]);
    evaluateMock.mockImplementation((v: { assetId: string }) => ({ vehicle: { id: v.assetId }, eligible: v.assetId === "veh-1", blockers: v.assetId === "veh-1" ? [] : ["NOT_ACTIVE"] }));

    const pool = await getTourServiceVehiclePool("svc-1");
    expect(poolFindManyMock).toHaveBeenCalledTimes(1); // batched, not per-vehicle
    expect(pool).toEqual([
      { vehicle: { id: "veh-1" }, eligible: true, blockers: [], addedAt: new Date("2026-02-01T00:00:00Z") },
      { vehicle: { id: "veh-2" }, eligible: false, blockers: ["NOT_ACTIVE"], addedAt: new Date("2026-03-01T00:00:00Z") },
    ]);
  });
});
