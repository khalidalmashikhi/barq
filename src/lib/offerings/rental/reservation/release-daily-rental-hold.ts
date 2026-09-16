import "server-only";
import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

// Phase 3C Slice C3/E1 — server-only voluntary RELEASE of a temporary daily-rental hold. Ownership
// lives on the hold-group HEADER (customerId), so release is authorized by re-reading the group:
// only the authenticated OWNER may release, and only HELD child rows transition to RELEASED (a
// CONFIRMED / EXPIRED / CANCELLED group is never released here). Idempotent: releasing an
// already-released group succeeds with releasedCount 0. Ownership is a where-clause predicate on the
// group, so a foreign or missing group resolves to a uniform NOT_FOUND — never leaking whether it
// exists or whose it is. Historical rows are never deleted.

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
      const group = await tx.rentalVehicleDayHoldGroup.findFirst({
        where: { id: params.holdGroupId, customerId: params.customerId },
        select: { id: true },
      });
      if (!group) return { ok: false as const, reason: "NOT_FOUND" as const };

      // Only HELD child rows → RELEASED. Repeated release is a no-op (count 0) — idempotent, no audit spam.
      const updated = await tx.rentalVehicleDayReservation.updateMany({
        where: { holdGroupId: params.holdGroupId, status: "HELD" },
        data: { status: "RELEASED", releasedAt: now },
      });

      if (updated.count > 0) {
        await tx.auditLog.create({
          data: {
            actorType: "CUSTOMER",
            actorId: params.customerId,
            action: "rental.daily_hold_released",
            entityType: "RentalVehicleDayHoldGroup",
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
