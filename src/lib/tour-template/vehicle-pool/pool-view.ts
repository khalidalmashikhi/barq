import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { TOUR_PACKAGE_SEMANTICS, type TourPackageKey } from "../packages";
import { loadOwnedTourServiceContext } from "./tour-service-context";
import { POOL_VEHICLE_SELECT, evaluatePoolVehicle, type EvaluatedPoolVehicle, type PoolVehicleRow } from "./pool-dto";
import type { VehicleAssignmentBlocker } from "./vehicle-assignment";

// TOUR-VEHICLE-2 — the ONE provider-private read model the pool UI and the v1 API both
// consume: a service's configured pool + the eligible-to-add candidates, each with live
// eligibility, in a SLIM, privacy-safe projection. Deliberately NOT ProviderVehicleDTO —
// it drops registrationNumber and every operational/timestamp field a pool selection
// never needs (§12), so the owner's plate is not leaked into a tour-configuration surface.
//
// Ownership-scoped: a foreign/missing service, or a service that is not an eligible tour
// context, returns null uniformly. Bounded queries only — the pool rows and the provider's
// vehicles are each fetched ONCE (with Asset status axes + documents), then evaluated in
// memory. A provider with N vehicles costs 2 queries, never N document round trips.

export type PoolVehicleView = {
  vehicleId: string;
  make: string | null;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  vehicleType: string | null;
  /** GUEST passenger capacity (excludes driver + operating guide). */
  passengerCapacity: number | null;
  /** TRUSTED, admin-confirmed 4x4 capability (derived; never the provider claim/type). */
  isFourByFour: boolean;
  eligible: boolean;
  blockers: VehicleAssignmentBlocker[];
  /** Whether this vehicle is currently configured in the service's pool. */
  isInPool: boolean;
};

export type TourVehiclePoolView = {
  packageType: TourPackageKey;
  /** False for GUIDE_ONLY — the package holds no vehicle pool. */
  vehicleAllowed: boolean;
  /** True for GUIDE_WITH_4X4 — only trusted-4x4 vehicles are eligible. */
  requiresFourByFour: boolean;
  /** The service's declared maximum guest party (guidingContent.maxGuests), or null. */
  maxGuests: number | null;
  /** Configured vehicles (each with LIVE eligibility — an ineligible one stays listed). */
  pool: PoolVehicleView[];
  /** The provider's other vehicles, not yet pooled, classified by eligibility. */
  available: PoolVehicleView[];
};

function toPoolVehicleView(evaluated: EvaluatedPoolVehicle, isInPool: boolean): PoolVehicleView {
  const v = evaluated.vehicle;
  return {
    vehicleId: v.id,
    make: v.make,
    model: v.model,
    modelYear: v.modelYear,
    color: v.color,
    vehicleType: v.vehicleType,
    passengerCapacity: v.passengerCapacity,
    isFourByFour: v.isFourByFour,
    eligible: evaluated.eligible,
    blockers: evaluated.blockers,
    isInPool,
  };
}

export async function getTourServiceVehiclePoolView(serviceId: string): Promise<TourVehiclePoolView | null> {
  if (!isValidUuid(serviceId)) return null;

  const { provider } = await requireApprovedProvider();

  const context = await loadOwnedTourServiceContext(prisma, provider.id, serviceId);
  if (!context.ok) return null;

  const semantics = TOUR_PACKAGE_SEMANTICS[context.context.packageType];
  const vehicleAllowed = semantics.includesTransport || semantics.vehicleOptional;

  // Two bounded queries: the configured pool, and (only when the package permits a
  // vehicle) the provider's full fleet to classify as add-candidates.
  const [poolRows, vehicles] = await Promise.all([
    prisma.tourServiceVehicle.findMany({
      where: { serviceId },
      orderBy: [{ createdAt: "asc" }, { vehicleId: "asc" }],
      select: { vehicle: { select: POOL_VEHICLE_SELECT } },
    }),
    vehicleAllowed
      ? prisma.vehicle.findMany({
          where: { asset: { providerId: provider.id, assetType: "VEHICLE" } },
          orderBy: [{ createdAt: "desc" }, { assetId: "desc" }],
          select: POOL_VEHICLE_SELECT,
        })
      : Promise.resolve([]),
  ]);

  const now = new Date();
  const pooledIds = new Set(poolRows.map((r) => r.vehicle.assetId));

  const pool = poolRows.map((r) =>
    toPoolVehicleView(evaluatePoolVehicle(r.vehicle as unknown as PoolVehicleRow, context.context, now), true),
  );
  const available = vehicles
    .filter((v) => !pooledIds.has(v.assetId))
    .map((v) => toPoolVehicleView(evaluatePoolVehicle(v as unknown as PoolVehicleRow, context.context, now), false));

  return {
    packageType: context.context.packageType,
    vehicleAllowed,
    requiresFourByFour: semantics.requiresFourByFour,
    maxGuests: context.context.maxGuests,
    pool,
    available,
  };
}
