import { describe, it, expect } from "vitest";
import { POOL_ASSET_SELECT, evaluatePoolVehicle, type PoolVehicleRow } from "./pool-dto";
import type { TourServiceContext } from "./tour-service-context";

const FUTURE = new Date("2027-01-01T00:00:00.000Z");

function row(overrides: Partial<PoolVehicleRow> = {}): PoolVehicleRow {
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
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    asset: {
      status: "ACTIVE",
      providerId: "prov-1",
      verificationStatus: "APPROVED",
      documents: [
        { type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: FUTURE },
        { type: "VEHICLE_INSURANCE", status: "APPROVED", expiresAt: FUTURE },
      ],
    },
    ...overrides,
  };
}

const ctx = (over: Partial<TourServiceContext> = {}): TourServiceContext => ({
  serviceId: "svc-1",
  providerId: "prov-1",
  packageType: "GUIDE_WITH_TRANSPORT",
  maxGuests: null,
  ...over,
});

describe("pool-dto — the shared fetch + evaluation contract", () => {
  it("POOL_ASSET_SELECT never fetches objectKey or any private document field", () => {
    expect(POOL_ASSET_SELECT.documents.select).toEqual({ type: true, status: true, expiresAt: true });
    expect(JSON.stringify(POOL_ASSET_SELECT)).not.toContain("objectKey");
  });

  it("evaluates a ready transport vehicle as eligible and returns the provider-private DTO (isFourByFour derived, no objectKey/asset leak)", () => {
    const out = evaluatePoolVehicle(row(), ctx());
    expect(out.eligible).toBe(true);
    expect(out.blockers).toEqual([]);
    // Provider (owner) view carries registration + the DERIVED isFourByFour...
    expect(out.vehicle.id).toBe("veh-1");
    expect(out.vehicle.registrationNumber).toBe("OM 12345");
    expect(out.vehicle.isFourByFour).toBe(false); // fourByFourVerified null → fail-closed
    // ...but never raw asset internals / objectKey / the raw trusted flag.
    const rec = out.vehicle as Record<string, unknown>;
    expect(rec.asset).toBeUndefined();
    expect(rec.objectKey).toBeUndefined();
    expect(rec.fourByFourVerified).toBeUndefined();
  });

  it("classifies a GUIDE_WITH_4X4 package against the TRUSTED flag only", () => {
    expect(evaluatePoolVehicle(row(), ctx({ packageType: "GUIDE_WITH_4X4" })).blockers).toContain("NOT_FOUR_BY_FOUR_CAPABLE");
    expect(evaluatePoolVehicle(row({ fourByFourVerified: true }), ctx({ packageType: "GUIDE_WITH_4X4" })).eligible).toBe(true);
  });
});
