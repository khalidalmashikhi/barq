import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { toPublicVehicle, type PublicVehicleDTO, type VehicleWithAsset } from "../vehicle-dto";
import { getVehicleSelectabilityBlockers } from "../selectability";
import { requiredAssetDocumentTypesFor } from "../documents/asset-document-types";

// VEHICLE-LC1 — the public-safe vehicle read primitive, for FUTURE Tour/Service
// surfaces (TOUR-VEHICLE). It returns the allowlisted PublicVehicleDTO only (never
// registrationNumber/status/documents/objectKey), and only when the SINGLE
// authoritative computed policy passes: operational ACTIVE + verification APPROVED
// + every required document APPROVED and unexpired (getVehicleSelectabilityBlockers).
// Fail-closed: any blocker → null. No auth gate (customer-facing by design).
//
// DELIBERATELY NOT WIRED into any public page in this gate — it exists so the later
// tour integration consumes one server-authoritative selectability decision.

export async function getPublicVehicle(assetId: string): Promise<PublicVehicleDTO | null> {
  if (!isValidUuid(assetId)) return null;

  const row = await prisma.vehicle.findFirst({
    where: { assetId, asset: { assetType: "VEHICLE" } },
    include: {
      asset: {
        select: {
          status: true,
          providerId: true,
          verificationStatus: true,
          // NEVER select objectKey — only what selectability needs.
          documents: { select: { type: true, status: true, expiresAt: true } },
        },
      },
    },
  });

  if (!row) return null;

  const blockers = getVehicleSelectabilityBlockers({
    status: row.asset.status,
    verificationStatus: row.asset.verificationStatus,
    requiredDocumentTypes: requiredAssetDocumentTypesFor("VEHICLE"),
    documents: row.asset.documents,
  });
  if (blockers.length > 0) return null;

  return toPublicVehicle(row as unknown as VehicleWithAsset);
}
