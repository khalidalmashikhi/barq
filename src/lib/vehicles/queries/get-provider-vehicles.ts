import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { toProviderVehicle, type ProviderVehicleDTO, type VehicleWithAsset } from "../vehicle-dto";

// VEHICLE-1 reader — the CURRENT provider's own vehicles (private DTO, includes
// registration + status). Scoped by providerId server-side; a provider can never
// list another provider's vehicles. Deterministic order (newest first, then id).
// Returns ALL of the provider's own vehicles, including deactivated ones — the
// owner manages their full fleet; the public projection is what hides inactive.

export async function getProviderVehicles(): Promise<ProviderVehicleDTO[]> {
  const { provider } = await requireApprovedProvider();

  const rows = await prisma.vehicle.findMany({
    where: { asset: { providerId: provider.id, assetType: "VEHICLE" } },
    include: { asset: { select: { status: true, providerId: true } } },
    orderBy: [{ createdAt: "desc" }, { assetId: "desc" }],
  });

  return (rows as VehicleWithAsset[]).map(toProviderVehicle);
}
