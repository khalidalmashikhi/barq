import "server-only";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { TourVehiclePoolResult } from "./pool-errors";

// TOUR-VEHICLE-1 — remove one vehicle from a tour service's pool. Provider identity is
// server-derived; the delete is scoped by BOTH serviceId and the owning providerId, so a
// provider can never remove a row from another provider's service. Removal only requires
// service OWNERSHIP (not tour eligibility) — a provider must be able to clean up a stale
// pool row even if the service's package later changed. Idempotent: removing an absent
// row is success with no audit event. Never touches ProviderCategory/B4-B5, the vehicle's
// own lifecycle, or any booking.

export async function removeVehicleFromTourServicePool(serviceId: string, vehicleId: string): Promise<TourVehiclePoolResult> {
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
    // Ownership — foreign/missing service is uniform SERVICE_NOT_FOUND.
    const service = await prisma.service.findFirst({ where: { id: serviceId, providerId }, select: { id: true } });
    if (!service) return { ok: false, error: "SERVICE_NOT_FOUND" };

    await prisma.$transaction(async (tx) => {
      // Scoped by the owning provider at the DB level too (defense in depth).
      const result = await tx.tourServiceVehicle.deleteMany({
        where: { serviceId, vehicleId, service: { providerId } },
      });
      // Only audit an actual removal — an absent row is a silent idempotent no-op.
      if (result.count > 0) {
        await recordAuditEvent(
          {
            actorType: "PROVIDER",
            actorId: providerId,
            action: "tour.vehicle_pool_removed",
            entityType: "Service",
            entityId: serviceId,
            previousValue: { vehicleId },
          },
          tx,
        );
      }
    });
    return { ok: true };
  } catch (error) {
    logger.error("removeVehicleFromTourServicePool.unexpected_error", {
      serviceId,
      vehicleId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
