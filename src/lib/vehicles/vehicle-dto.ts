import type { AssetStatus } from "@prisma/client";

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
  passengerCapacity: number | null;
  publicDescription: string | null;
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
  };
}

// PRIVATE — the owning provider's (and, later, an authorized admin's) view. Adds
// the private registrationNumber and the operational status/timestamps on top of
// the public fields. Still an explicit allowlist: no documents/objectKey/provider
// id are included.
export type ProviderVehicleDTO = PublicVehicleDTO & {
  registrationNumber: string | null;
  status: AssetStatus;
  createdAt: Date;
  updatedAt: Date;
};

export function toProviderVehicle(row: VehicleWithAsset): ProviderVehicleDTO {
  return {
    ...toPublicVehicle(row),
    registrationNumber: row.registrationNumber,
    status: row.asset.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// FAIL-CLOSED public/selectable rule: a vehicle is customer-visible / eligible
// for future Tour/Service use ONLY when it is operationally ACTIVE. Every other
// AssetStatus — REGISTERED (created, not yet operational), VERIFIED,
// UNDER_MAINTENANCE, DEACTIVATED — is NOT public. ACTIVE is deliberately the
// single explicit operational state; the repo has no AssetStatus lifecycle yet,
// so VEHICLE-1 does not decide how a vehicle BECOMES active — a later explicit
// verification/lifecycle gate owns that. Until then a newly-created vehicle is
// visible to its owner (private reader) but never public.
export function isVehicleSelectable(status: AssetStatus): boolean {
  return status === "ACTIVE";
}
