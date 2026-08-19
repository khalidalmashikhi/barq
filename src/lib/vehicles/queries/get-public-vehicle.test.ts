import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/uuid", () => ({ isValidUuid: (v: unknown) => typeof v === "string" && v.length > 0 }));

const vehicleFindFirstMock = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { vehicle: { findFirst: (...a: unknown[]) => vehicleFindFirstMock(...a) } } }));

const { getPublicVehicle } = await import("./get-public-vehicle");

const row = (status: string) => ({
  assetId: "asset-1",
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR",
  passengerCapacity: 6,
  publicDescription: "Desert-ready.",
  registrationNumber: "OM 12345",
  createdAt: new Date(),
  updatedAt: new Date(),
  asset: { status, providerId: "prov-1" },
});

afterEach(() => vehicleFindFirstMock.mockReset());

describe("getPublicVehicle — fail-closed public projection (ACTIVE only, unwired)", () => {
  it("returns ONLY the public allowlist for an ACTIVE vehicle (no registration)", async () => {
    vehicleFindFirstMock.mockResolvedValue(row("ACTIVE"));
    const dto = await getPublicVehicle("asset-1");
    expect(dto).not.toBeNull();
    expect(Object.keys(dto!).sort()).toEqual(
      ["color", "id", "make", "model", "modelYear", "passengerCapacity", "publicDescription", "vehicleType"].sort(),
    );
    expect(JSON.stringify(dto)).not.toContain("OM 12345");
  });

  it("does NOT expose a non-ACTIVE vehicle publicly (REGISTERED/VERIFIED/UNDER_MAINTENANCE/DEACTIVATED → null)", async () => {
    for (const status of ["REGISTERED", "VERIFIED", "UNDER_MAINTENANCE", "DEACTIVATED"]) {
      vehicleFindFirstMock.mockResolvedValue(row(status));
      expect(await getPublicVehicle("asset-1")).toBeNull();
    }
  });

  it("returns null for a missing vehicle or malformed id", async () => {
    vehicleFindFirstMock.mockResolvedValue(null);
    expect(await getPublicVehicle("asset-x")).toBeNull();
    expect(await getPublicVehicle("")).toBeNull();
  });
});
