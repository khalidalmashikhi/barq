import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { TOUR_PACKAGE_SEMANTICS } from "../packages";
import { loadOwnedTourServiceContext } from "./tour-service-context";
import { POOL_VEHICLE_SELECT, evaluatePoolVehicle, type PoolVehicleRow } from "./pool-dto";
import type { TourVehiclePoolResult } from "./pool-errors";

// TOUR-VEHICLE-1 — add one of the CURRENT provider's own vehicles to a tour service's
// eligible pool. Every authority is enforced SERVER-SIDE from the authenticated session
// (providerId is never accepted from the caller):
//   1. approved-provider gate,
//   2. service ownership + tour eligibility (loadOwnedTourServiceContext),
//   3. the package must permit a vehicle at all (GUIDE_ONLY → not a pool context),
//   4. vehicle ownership (same provider) — foreign/missing → uniform VEHICLE_NOT_FOUND,
//   5. LIVE assignment eligibility (getVehicleAssignmentBlockers) — not-ready → VEHICLE_NOT_ELIGIBLE.
// Adding an already-pooled vehicle is idempotent SUCCESS (the composite PK makes the
// insert a no-op). Adding a vehicle NEVER creates/alters a ProviderCategory or any B4/B5
// authorization — vehicle ownership is not service authorization.

export async function addVehicleToTourServicePool(serviceId: string, vehicleId: string): Promise<TourVehiclePoolResult> {
  if (!isValidUuid(serviceId) || !isValidUuid(vehicleId)) return { ok: false, error: "INVALID_INPUT" };

  let providerId: string;
  try {
    const auth = await requireApprovedProvider();
    providerId = auth.provider.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError) throw error;
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    }
    throw error;
  }

  try {
    const context = await loadOwnedTourServiceContext(prisma, providerId, serviceId);
    if (!context.ok) return { ok: false, error: context.error };

    // The package must allow a vehicle at all — GUIDE_ONLY holds no vehicle pool.
    const semantics = TOUR_PACKAGE_SEMANTICS[context.context.packageType];
    if (!semantics.includesTransport && !semantics.vehicleOptional) {
      return { ok: false, error: "TOUR_SERVICE_NOT_ELIGIBLE" };
    }

    // Vehicle ownership — scoped to the provider; foreign/missing is uniform.
    const vehicle = await prisma.vehicle.findFirst({
      where: { assetId: vehicleId, asset: { providerId, assetType: "VEHICLE" } },
      select: POOL_VEHICLE_SELECT,
    });
    if (!vehicle) return { ok: false, error: "VEHICLE_NOT_FOUND" };

    // Live eligibility for THIS package (operational + verification + docs + 4x4 + capacity).
    const { blockers } = evaluatePoolVehicle(vehicle as unknown as PoolVehicleRow, context.context);
    if (blockers.length > 0) return { ok: false, error: "VEHICLE_NOT_ELIGIBLE" };

    // Idempotent insert + audit. A unique-violation means it is already pooled → success
    // with no duplicate row and no audit event (nothing changed).
    await prisma.$transaction(async (tx) => {
      await tx.tourServiceVehicle.create({ data: { serviceId, vehicleId } });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "tour.vehicle_pool_added",
          entityType: "Service",
          entityId: serviceId,
          newValue: { vehicleId },
        },
        tx,
      );
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: true }; // already pooled — idempotent
    }
    logger.error("addVehicleToTourServicePool.unexpected_error", {
      serviceId,
      vehicleId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
