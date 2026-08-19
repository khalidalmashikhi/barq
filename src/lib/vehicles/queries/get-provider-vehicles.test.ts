import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.length > 0 }));

const requireApprovedProviderMock = vi.fn();
vi.mock("@/lib/auth", () => ({ requireApprovedProvider: (...a: unknown[]) => requireApprovedProviderMock(...a) }));

const vehicleFindManyMock = vi.fn();
const vehicleFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    vehicle: {
      findMany: (...a: unknown[]) => vehicleFindManyMock(...a),
      findFirst: (...a: unknown[]) => vehicleFindFirstMock(...a),
    },
  },
}));

const { getProviderVehicles } = await import("./get-provider-vehicles");
const { getProviderVehicle } = await import("./get-provider-vehicle");

const dbRow = {
  assetId: "asset-1",
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR",
  passengerCapacity: 6,
  publicDescription: null,
  registrationNumber: "OM 12345",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  asset: { status: "REGISTERED", providerId: "prov-1" },
};

afterEach(() => {
  requireApprovedProviderMock.mockReset();
  vehicleFindManyMock.mockReset();
  vehicleFindFirstMock.mockReset();
});

describe("getProviderVehicles — scoped to the caller", () => {
  it("lists only the caller's vehicles (providerId scope) as PRIVATE DTOs", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    vehicleFindManyMock.mockResolvedValue([dbRow]);

    const result = await getProviderVehicles();

    expect(vehicleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { asset: { providerId: "prov-1", assetType: "VEHICLE" } } }),
    );
    expect(result).toHaveLength(1);
    // Private DTO includes registration + status; the id is the assetId.
    expect(result[0]).toMatchObject({ id: "asset-1", registrationNumber: "OM 12345", status: "REGISTERED" });
  });

  it("orders deterministically (newest first, then id)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    vehicleFindManyMock.mockResolvedValue([]);
    await getProviderVehicles();
    expect(vehicleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "desc" }, { assetId: "desc" }] }),
    );
  });
});

describe("getProviderVehicle — cannot read another provider's vehicle", () => {
  it("returns null when the scoped lookup misses (foreign vehicle never revealed)", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-2" } });
    vehicleFindFirstMock.mockResolvedValue(null);
    expect(await getProviderVehicle("asset-1")).toBeNull();
    expect(vehicleFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ assetId: "asset-1", asset: { providerId: "prov-2", assetType: "VEHICLE" } }) }),
    );
  });

  it("returns the private DTO for the caller's own vehicle", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    vehicleFindFirstMock.mockResolvedValue(dbRow);
    const dto = await getProviderVehicle("asset-1");
    expect(dto).toMatchObject({ id: "asset-1", registrationNumber: "OM 12345", status: "REGISTERED" });
  });

  it("returns null for a malformed id without querying", async () => {
    requireApprovedProviderMock.mockResolvedValue({ provider: { id: "prov-1" } });
    expect(await getProviderVehicle("")).toBeNull();
    expect(vehicleFindFirstMock).not.toHaveBeenCalled();
  });
});
