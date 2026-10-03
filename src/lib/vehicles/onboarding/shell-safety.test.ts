import { describe, it, expect } from "vitest";
import { getVehicleSelectabilityBlockers, isVehicleSelectable } from "@/lib/vehicles/selectability";
import { getVehicleAssignmentBlockers, isVehicleAssignable } from "@/lib/tour-template/vehicle-pool/vehicle-assignment";
import { toPublicVehicle, type VehicleWithAsset } from "@/lib/vehicles/vehicle-dto";

// Gate 3 — an incomplete document-first onboarding shell (Asset.status REGISTERED + verification
// DRAFT + all business fields null) is INERT across every real seam: customer selectability, the
// public DTO, and guided-tour vehicle assignment. The invariant is NOT "no Vehicle row exists"
// (Option A creates a shell row) — it is: no USABLE / VERIFIED / CUSTOMER-VISIBLE / OFFERING-ELIGIBLE
// vehicle is produced from unreviewed parser output.

// The snapshot of a freshly-created shell (a document uploaded, nothing confirmed, nothing approved).
const shellSelectability = {
  status: "REGISTERED" as const,
  verificationStatus: "DRAFT" as const,
  requiredDocumentTypes: ["VEHICLE_REGISTRATION"],
  documents: [{ type: "VEHICLE_REGISTRATION", status: "PENDING" as const, expiresAt: null }],
};

const shellRow: VehicleWithAsset = {
  assetId: "shell-asset-id",
  make: null, model: null, modelYear: null, color: null, vehicleType: null,
  bookablePassengerCapacity: null, registeredSeats: null, licensedPassengerCapacity: null,
  publicDescription: null, registrationNumber: null, claimedFourByFour: null, fourByFourVerified: null,
  createdAt: new Date(), updatedAt: new Date(),
  asset: { status: "REGISTERED", providerId: "prov-1" },
};

describe("onboarding shell is inert across every seam", () => {
  it("is NOT customer-selectable (fail-closed: not ACTIVE, not APPROVED, doc not approved)", () => {
    const blockers = getVehicleSelectabilityBlockers(shellSelectability);
    expect(blockers).toContain("NOT_ACTIVE");
    expect(blockers).toContain("VERIFICATION_NOT_APPROVED");
    expect(blockers).toContain("REQUIRED_DOCUMENT_NOT_APPROVED");
    expect(isVehicleSelectable(shellSelectability)).toBe(false);
  });

  it("cannot be assigned to a guided tour (assignment composes the same selectability block)", () => {
    const input = {
      packageType: "GUIDE_WITH_4X4" as const,
      ...shellSelectability,
      fourByFourVerified: null,
      guestCapacity: null,
      serviceMaxGuests: null,
    };
    const blockers = getVehicleAssignmentBlockers(input);
    expect(blockers).toContain("NOT_ACTIVE");
    expect(blockers).toContain("VERIFICATION_NOT_APPROVED");
    expect(isVehicleAssignable(input)).toBe(false);
  });

  it("its public projection carries NO usable/sensitive data (all customer facts null; no private fields)", () => {
    const pub = toPublicVehicle(shellRow);
    expect(pub).toEqual({ id: "shell-asset-id", make: null, model: null, modelYear: null, color: null, vehicleType: null, passengerCapacity: null, publicDescription: null, isFourByFour: false });
    const rec = pub as unknown as Record<string, unknown>;
    for (const forbidden of ["registrationNumber", "status", "providerId", "registeredSeats", "licensedPassengerCapacity", "asset", "objectKey"]) {
      expect(rec[forbidden]).toBeUndefined();
    }
  });

  it("even if its document were somehow APPROVED, REGISTERED/DRAFT still blocks selectability", () => {
    const blockers = getVehicleSelectabilityBlockers({ ...shellSelectability, documents: [{ type: "VEHICLE_REGISTRATION", status: "APPROVED", expiresAt: null }] });
    expect(blockers).toEqual(["NOT_ACTIVE", "VERIFICATION_NOT_APPROVED"]);
  });
});
