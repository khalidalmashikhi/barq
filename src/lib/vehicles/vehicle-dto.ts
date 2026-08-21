import type { AssetStatus } from "@prisma/client";
import { isVehicleFourByFourCapable } from "./capability";

// VEHICLE-1 — the explicit public/private projection boundary for a Vehicle.
//
// PUBLIC vs PRIVATE is enforced by CONSTRUCTION: each builder assigns only its
// allowlisted fields — there is deliberately no `...row` spread anywhere, so a
// private column (registrationNumber) or an admin/storage field can never leak
// into a public DTO by accident. This boundary is test-pinned.

// The joined DB shape both builders read (Vehicle + its base Asset). Status lives
// on Asset; the customer-safe fields live on Vehicle.
export type VehicleWithAsset = {
  assetId: string;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  vehicleType: string | null;
  passengerCapacity: number | null;
  publicDescription: string | null;
  registrationNumber: string | null;
  claimedFourByFour: boolean | null;
  fourByFourVerified: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  asset: { status: AssetStatus; providerId: string };
};

// PUBLIC — the ONLY vehicle fields a customer/tour surface may ever see. No
// registrationNumber, status, documents, objectKey, signed URLs, provider id, or
// admin metadata. `id` is the vehicle's stable identity (its assetId).
export type PublicVehicleDTO = {
  id: string;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  vehicleType: string | null;
  /** GUEST/customer passenger capacity (excludes driver + operating guide) — TOUR-VEHICLE-CAP. */
  passengerCapacity: number | null;
  publicDescription: string | null;
  /** TOUR-VEHICLE-CAP — customer-safe TRUSTED 4x4 capability (admin-confirmed only; never the provider claim). */
  isFourByFour: boolean;
};

export function toPublicVehicle(row: VehicleWithAsset): PublicVehicleDTO {
  return {
    id: row.assetId,
    make: row.make,
    model: row.model,
    modelYear: row.modelYear,
    color: row.color,
    vehicleType: row.vehicleType,
    passengerCapacity: row.passengerCapacity,
    publicDescription: row.publicDescription,
    // Derived from the trusted flag ONLY — never the provider claim, never inferred.
    isFourByFour: isVehicleFourByFourCapable(row),
  };
}

// PRIVATE — the owning provider's (and, later, an authorized admin's) view. Adds
// the private registrationNumber and the operational status/timestamps on top of
// the public fields. Still an explicit allowlist: no documents/objectKey/provider
// id are included.
export type ProviderVehicleDTO = PublicVehicleDTO & {
  registrationNumber: string | null;
  status: AssetStatus;
  /** TOUR-VEHICLE-CAP — the provider's own ADVISORY 4x4 declaration (distinct from the trusted isFourByFour). */
  claimedFourByFour: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toProviderVehicle(row: VehicleWithAsset): ProviderVehicleDTO {
  return {
    ...toPublicVehicle(row),
    registrationNumber: row.registrationNumber,
    status: row.asset.status,
    claimedFourByFour: row.claimedFourByFour,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// NOTE (VEHICLE-LC1): the old status-only `isVehicleSelectable(status)` has been
// REPLACED by the authoritative computed policy in src/lib/vehicles/selectability.ts
// (getVehicleSelectabilityBlockers / isVehicleSelectable), which requires ACTIVE
// status AND APPROVED verification AND all required documents valid+unexpired.
// There is deliberately no status-only shortcut here, so the fail-closed rule
// lives in exactly one place.
