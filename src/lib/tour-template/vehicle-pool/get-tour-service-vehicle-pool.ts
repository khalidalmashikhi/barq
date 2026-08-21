import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { loadOwnedTourServiceContext } from "./tour-service-context";
import { POOL_ASSET_SELECT, evaluatePoolVehicle, type EvaluatedPoolVehicle, type PoolVehicleRow } from "./pool-dto";

// TOUR-VEHICLE-1 — the provider-private reader for a tour service's CONFIGURED vehicle
// pool, each row carrying its LIVE eligibility. Ownership-scoped: a foreign/missing
// service, or a service that is not an eligible tour context, returns null uniformly (no
// enumeration). One batched query brings every pooled vehicle with its Asset status axes
// and documents — eligibility is then computed in memory, so N pooled vehicles cost ONE
// document query, not N.

export type PooledVehicle = EvaluatedPoolVehicle & {
  /** When this vehicle was added to the pool. */
  addedAt: Date;
};

export async function getTourServiceVehiclePool(serviceId: string): Promise<PooledVehicle[] | null> {
  if (!isValidUuid(serviceId)) return null;

  const { provider } = await requireApprovedProvider();

  const context = await loadOwnedTourServiceContext(prisma, provider.id, serviceId);
  if (!context.ok) return null;

  const rows = await prisma.tourServiceVehicle.findMany({
    where: { serviceId },
    orderBy: [{ createdAt: "asc" }, { vehicleId: "asc" }],
    select: {
      createdAt: true,
      vehicle: {
        select: {
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
        },
      },
    },
  });

  const now = new Date();
  return rows.map((row) => {
    const evaluated = evaluatePoolVehicle(row.vehicle as unknown as PoolVehicleRow, context.context, now);
    return { ...evaluated, addedAt: row.createdAt };
  });
}
