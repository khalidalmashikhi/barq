import "server-only";
import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

// Phase 3C Slice C3/E1 — server-only voluntary RELEASE of a temporary daily-rental hold. Only the
// authenticated OWNER may release, and only a HELD row may transition to RELEASED (a CONFIRMED /
// EXPIRED / CANCELLED row is never released here). Idempotent: releasing an already-released group
// succeeds with releasedCount 0. Ownership is a where-clause predicate (customerId), so a foreign or
// missing group resolves to a uniform NOT_FOUND — never leaking whether it exists or whose it is.

export type ReleaseDailyRentalHoldResult =
  | { ok: true; releasedCount: number }
  | { ok: false; reason: "NOT_FOUND" | "READ_FAILED" };

export async function releaseDailyRentalHold(
  prisma: PrismaClient,
  params: { holdGroupId: string; customerId: string; now?: Date },
): Promise<ReleaseDailyRentalHoldResult> {
  const now = params.now ?? new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      // The group must belong to THIS customer (non-enumerating: foreign/missing → NOT_FOUND).
      const owned = await tx.rentalVehicleDayReservation.findFirst({
        where: { holdGroupId: params.holdGroupId, customerId: params.customerId },
        select: { id: true },
      });
      if (!owned) return { ok: false as const, reason: "NOT_FOUND" as const };

      // Only HELD → RELEASED. Repeated release is a no-op (count 0) — idempotent, no audit spam.
      const updated = await tx.rentalVehicleDayReservation.updateMany({
        where: { holdGroupId: params.holdGroupId, customerId: params.customerId, status: "HELD" },
        data: { status: "RELEASED", releasedAt: now },
      });

      if (updated.count > 0) {
        await tx.auditLog.create({
          data: {
            actorType: "CUSTOMER",
            actorId: params.customerId,
            action: "rental.daily_hold_released",
            entityType: "RentalVehicleDayReservation",
            entityId: params.holdGroupId,
            newValue: { holdGroupId: params.holdGroupId, releasedCount: updated.count },
          },
        });
      }
      return { ok: true as const, releasedCount: updated.count };
    });
  } catch (error) {
    logger.error("releaseDailyRentalHold.read_failed", {
      holdGroupId: params.holdGroupId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "READ_FAILED" };
  }
}
