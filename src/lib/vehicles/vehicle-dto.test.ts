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
  // TOUR-VEHICLE-CAP — FOUR_BY_FOUR vehicleType + a provider claim of true, but the
  // trusted admin flag is null → NOT 4x4-capable (fail-closed; type/claim never infer it).
  claimedFourByFour: true,
  fourByFourVerified: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
  asset: { status: "REGISTERED", providerId: "prov-1", objectKey: "secret/key.pdf" },
} as unknown as VehicleWithAsset;

describe("toPublicVehicle — the customer allowlist boundary", () => {
  it("contains ONLY the allowlisted public fields", () => {
    const dto = toPublicVehicle(row);
    expect(Object.keys(dto).sort()).toEqual(
      ["color", "id", "isFourByFour", "make", "model", "modelYear", "passengerCapacity", "publicDescription", "vehicleType"].sort(),
    );
  });

  it("never exposes registrationNumber, status, provider id, objectKey, timestamps, or the raw 4x4 claim/flag", () => {
    const dto = toPublicVehicle(row) as Record<string, unknown>;
    for (const forbidden of ["registrationNumber", "status", "providerId", "objectKey", "createdAt", "updatedAt", "asset", "claimedFourByFour", "fourByFourVerified"]) {
      expect(dto[forbidden]).toBeUndefined();
    }
    // Full serialized surface contains no plate value.
    expect(JSON.stringify(dto)).not.toContain("OM 12345");
    expect(JSON.stringify(dto)).not.toContain("secret/key.pdf");
  });

  it("TOUR-VEHICLE-CAP — isFourByFour is FALSE for a FOUR_BY_FOUR type + provider claim but no trusted verification (fail-closed)", () => {
    expect(toPublicVehicle(row).isFourByFour).toBe(false);
    // Only the trusted flag flips it; the derived value never reads type/claim.
    expect(toPublicVehicle({ ...row, fourByFourVerified: true }).isFourByFour).toBe(true);
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

  it("TOUR-VEHICLE-CAP — surfaces the provider's own claim + the trusted derived isFourByFour", () => {
    const dto = toProviderVehicle(row);
    expect(dto.claimedFourByFour).toBe(true); // owner sees their advisory declaration
    expect(dto.isFourByFour).toBe(false); // trusted (fail-closed) — not yet admin-verified
    // The raw trusted flag is not surfaced directly; only the derived boolean is.
    expect((dto as Record<string, unknown>).fourByFourVerified).toBeUndefined();
  });
});

// Selectability moved to src/lib/vehicles/selectability.ts (computed from
// status + verification + documents) — tested in selectability.test.ts.
