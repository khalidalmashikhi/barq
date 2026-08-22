import type { AssetStatus, AssetVerificationStatus, AssetDocumentStatus } from "@prisma/client";
import { toProviderVehicle, type ProviderVehicleDTO, type VehicleWithAsset } from "@/lib/vehicles/vehicle-dto";
import { requiredAssetDocumentTypesFor } from "@/lib/vehicles/documents/asset-document-types";
import { getVehicleAssignmentBlockers, type VehicleAssignmentBlocker } from "./vehicle-assignment";
import type { TourServiceContext } from "./tour-service-context";

// TOUR-VEHICLE-1 — the shared fetch shape + eligibility mapper for the pool readers and
// the write operations, so every surface evaluates a vehicle the SAME way and the fetch
// stays batched (one query brings the vehicle, its base Asset's two status axes, and its
// documents — no per-vehicle document round trip).

// The Prisma `select` for a vehicle's base Asset when evaluating pool eligibility. Note
// it deliberately excludes objectKey and every other private/storage field — eligibility
// needs only the document TYPE, STATUS, and trusted EXPIRY.
export const POOL_ASSET_SELECT = {
  status: true,
  providerId: true,
  verificationStatus: true,
  documents: { select: { type: true, status: true, expiresAt: true } },
} as const;

// The single Prisma `select` for a Vehicle when evaluating pool eligibility — the
// customer-safe/owner fields toProviderVehicle needs plus the base Asset's two status
// axes + documents. Shared by every pool reader/op so the batched fetch shape is defined
// exactly once (no drift, no per-vehicle document round trip).
export const POOL_VEHICLE_SELECT = {
  assetId: true,
  make: true,
  model: true,
  modelYear: true,
  color: true,
  vehicleType: true,
  passengerCapacity: true,
  publicDescription: true,
  registrationNumber: true,
  claimedFourByFour: true,
  fourByFourVerified: true,
  createdAt: true,
  updatedAt: true,
  asset: { select: POOL_ASSET_SELECT },
} as const;

// The DB row shape the mapper consumes (a superset of VehicleWithAsset — structurally
// assignable to it, so toProviderVehicle still only reads its allowlisted public fields).
export type PoolVehicleRow = VehicleWithAsset & {
  asset: {
    status: AssetStatus;
    providerId: string;
    verificationStatus: AssetVerificationStatus;
    documents: { type: string; status: AssetDocumentStatus; expiresAt: Date | null }[];
  };
};

// One evaluated pool/candidate vehicle: the safe provider-own projection (which already
// carries the derived isFourByFour and never registrationNumber's private siblings) plus
// its LIVE eligibility for the given tour package. `eligible: false` with populated
// `blockers` is how a "configured but currently unavailable" vehicle is represented.
export type EvaluatedPoolVehicle = {
  vehicle: ProviderVehicleDTO;
  eligible: boolean;
  blockers: VehicleAssignmentBlocker[];
};

export function evaluatePoolVehicle(row: PoolVehicleRow, context: TourServiceContext, now?: Date): EvaluatedPoolVehicle {
  const blockers = getVehicleAssignmentBlockers({
    packageType: context.packageType,
    status: row.asset.status,
    verificationStatus: row.asset.verificationStatus,
    fourByFourVerified: row.fourByFourVerified,
    guestCapacity: row.passengerCapacity,
    serviceMaxGuests: context.maxGuests,
    requiredDocumentTypes: requiredAssetDocumentTypesFor("VEHICLE"),
    documents: row.asset.documents.map((d) => ({ type: d.type, status: d.status, expiresAt: d.expiresAt })),
    now,
  });
  return { vehicle: toProviderVehicle(row), blockers, eligible: blockers.length === 0 };
}
