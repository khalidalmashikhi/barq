import { describe, it, expect } from "vitest";
import { toPublicVehicle, toProviderVehicle, type VehicleWithAsset } from "./vehicle-dto";

// A row that also carries fields a public DTO must NEVER surface (registration,
// status, provider id, and — via cast — a bogus private-ish extra).
const row = {
  assetId: "asset-1",
  make: "Toyota",
  model: "Land Cruiser",
  modelYear: 2025,
  color: "White",
  vehicleType: "FOUR_BY_FOUR",
  passengerCapacity: 6,
  publicDescription: "Desert-ready.",
  registrationNumber: "OM 12345",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  asset: { status: "REGISTERED", providerId: "prov-1", objectKey: "secret/key.pdf" },
} as unknown as VehicleWithAsset;

describe("toPublicVehicle — the customer allowlist boundary", () => {
  it("contains ONLY the allowlisted public fields", () => {
    const dto = toPublicVehicle(row);
    expect(Object.keys(dto).sort()).toEqual(
      ["color", "id", "make", "model", "modelYear", "passengerCapacity", "publicDescription", "vehicleType"].sort(),
    );
  });

  it("never exposes registrationNumber, status, provider id, objectKey, or timestamps", () => {
    const dto = toPublicVehicle(row) as Record<string, unknown>;
    for (const forbidden of ["registrationNumber", "status", "providerId", "objectKey", "createdAt", "updatedAt", "asset"]) {
      expect(dto[forbidden]).toBeUndefined();
    }
    // Full serialized surface contains no plate value.
    expect(JSON.stringify(dto)).not.toContain("OM 12345");
    expect(JSON.stringify(dto)).not.toContain("secret/key.pdf");
  });

  it("maps id from assetId", () => {
    expect(toPublicVehicle(row).id).toBe("asset-1");
  });
});

describe("toProviderVehicle — the owner/private view", () => {
  it("adds registration + status + timestamps on top of the public allowlist", () => {
    const dto = toProviderVehicle(row);
    expect(dto.registrationNumber).toBe("OM 12345");
    expect(dto.status).toBe("REGISTERED");
    expect(dto.id).toBe("asset-1");
    // still no raw provider id / objectKey / nested asset
    const rec = dto as Record<string, unknown>;
    expect(rec.providerId).toBeUndefined();
    expect(rec.objectKey).toBeUndefined();
    expect(rec.asset).toBeUndefined();
  });
});

// Selectability moved to src/lib/vehicles/selectability.ts (computed from
// status + verification + documents) — tested in selectability.test.ts.
