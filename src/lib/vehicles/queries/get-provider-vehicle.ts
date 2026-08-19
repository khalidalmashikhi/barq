import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { toProviderVehicle, type ProviderVehicleDTO, type VehicleWithAsset } from "../vehicle-dto";

// VEHICLE-1 reader — one of the CURRENT provider's own vehicles (private DTO),
// ownership enforced by a providerId-scoped query. Returns null for a malformed
// id, a non-existent vehicle, OR a vehicle owned by another provider — one
// outcome, so ownership can never be probed.

export async function getProviderVehicle(assetId: string): Promise<ProviderVehicleDTO | null> {
  if (!isValidUuid(assetId)) return null;

  const { provider } = await requireApprovedProvider();

  const row = await prisma.vehicle.findFirst({
    where: { assetId, asset: { providerId: provider.id, assetType: "VEHICLE" } },
    include: { asset: { select: { status: true, providerId: true } } },
  });

  return row ? toProviderVehicle(row as VehicleWithAsset) : null;
}
