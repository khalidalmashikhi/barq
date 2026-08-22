import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { TOUR_PACKAGE_SEMANTICS } from "../packages";
import { loadOwnedTourServiceContext } from "./tour-service-context";
import { POOL_VEHICLE_SELECT, evaluatePoolVehicle, type EvaluatedPoolVehicle, type PoolVehicleRow } from "./pool-dto";

// TOUR-VEHICLE-1 — the reusable domain reader TOUR-VEHICLE-2's "add a vehicle" selector
// will consume. Returns the provider's own vehicles that are NOT already pooled on this
// tour service, each CLASSIFIED by live assignment eligibility (so the UI can show which
// are ready to add and why the rest are not). Ownership-scoped; a foreign/missing/
// non-tour service returns null uniformly.
//
// Bounded queries only — the provider's vehicles (with Asset status axes + documents) in
// ONE query and the pool membership in ONE query; eligibility is evaluated in memory. No
// per-vehicle round trip.

export type AssignableVehicle = EvaluatedPoolVehicle;

export async function getEligibleProviderVehiclesForTourService(serviceId: string): Promise<AssignableVehicle[] | null> {
  if (!isValidUuid(serviceId)) return null;

  const { provider } = await requireApprovedProvider();

  const context = await loadOwnedTourServiceContext(prisma, provider.id, serviceId);
  if (!context.ok) return null;

  // GUIDE_ONLY (vehicle forbidden) has no candidates to add — return an empty list, not
  // every vehicle flagged blocked.
  const semantics = TOUR_PACKAGE_SEMANTICS[context.context.packageType];
  if (!semantics.includesTransport && !semantics.vehicleOptional) return [];

  const [vehicles, pooled] = await Promise.all([
    prisma.vehicle.findMany({
      where: { asset: { providerId: provider.id, assetType: "VEHICLE" } },
      orderBy: [{ createdAt: "desc" }, { assetId: "desc" }],
      select: POOL_VEHICLE_SELECT,
    }),
    prisma.tourServiceVehicle.findMany({ where: { serviceId }, select: { vehicleId: true } }),
  ]);

  const pooledIds = new Set(pooled.map((p) => p.vehicleId));
  const now = new Date();

  return vehicles
    .filter((v) => !pooledIds.has(v.assetId))
    .map((v) => evaluatePoolVehicle(v as unknown as PoolVehicleRow, context.context, now));
}
