import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parseOmanDateKey, dbDateFromOmanDateKey } from "@/lib/date/oman-time";
import { resolveApprovedProvider, loadOwnedRentalOffering, assertRentalEditAuthorized } from "./rental-offering-authorization";
import { isRentalOfferingArchived } from "./rental-offering-lifecycle";
import type { RentalOfferingResult } from "./rental-offering-errors";

// Phase 3C Slice C2b-R — block a single rental day (mutation 7). Blocking is an explicit close of a
// day that was previously opened: the OfferingDay row MUST already exist (→ OFFERING_DAY_NOT_FOUND
// otherwise). Absence already means unavailable (fail-closed), so blocking a never-opened day is a
// no-op with no row to change — this mutation never creates a row, mirroring the day-must-exist rule
// of the override and start-time mutations. Re-blocking an already-BLOCKED day is an idempotent
// no-op. Any existing price override and start-times on the day are preserved (only `state` changes).

export type BlockRentalDayInput = {
  offeringId: string;
  /** The Oman calendar date key (YYYY-MM-DD) to block. */
  date: string;
};

export type BlockRentalDayResult = { offeringId: string; date: string; state: "BLOCKED" };

export async function blockRentalDay(input: BlockRentalDayInput): Promise<RentalOfferingResult<BlockRentalDayResult>> {
  const auth = await resolveApprovedProvider();
  if (!auth.ok) return auth;
  const { providerId } = auth;
  if (!isValidUuid(input?.offeringId)) return { ok: false, error: "OFFERING_NOT_FOUND" };

  const dateKey = parseOmanDateKey(input?.date);
  const dbDate = dateKey === null ? null : dbDateFromOmanDateKey(dateKey);
  if (dateKey === null || dbDate === null) return { ok: false, error: "INVALID_DATE" };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const offering = await loadOwnedRentalOffering(tx, providerId, input.offeringId);
      if (!offering) return { ok: false as const, error: "OFFERING_NOT_FOUND" as const };
      if (isRentalOfferingArchived(offering.status)) return { ok: false as const, error: "OFFERING_ARCHIVED" as const };
      if (offering.serviceOfferingKind !== "VEHICLE_RENTAL") return { ok: false as const, error: "WRONG_SERVICE_KIND" as const };

      const editGate = await assertRentalEditAuthorized(tx, providerId, offering);
      if (editGate !== null) return { ok: false as const, error: editGate };

      // The day must already exist; a close never creates a row (absence already = unavailable).
      const day = await tx.rentalOfferingDay.findUnique({
        where: { rentalOfferingId_serviceDate: { rentalOfferingId: offering.id, serviceDate: dbDate } },
        select: { id: true, state: true },
      });
      if (!day) return { ok: false as const, error: "OFFERING_DAY_NOT_FOUND" as const };
      if (day.state === "BLOCKED") return { ok: true as const, value: { offeringId: offering.id, date: dateKey, state: "BLOCKED" as const } }; // idempotent

      // Guarded on the current OPEN state so a concurrent transition cannot be overwritten.
      const updated = await tx.rentalOfferingDay.updateMany({
        where: { id: day.id, state: "OPEN" },
        data: { state: "BLOCKED" },
      });
      if (updated.count === 0) return { ok: false as const, error: "OFFERING_STATE_CONFLICT" as const };

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "rental_offering.day_blocked",
          entityType: "RentalOfferingDay",
          entityId: day.id,
          previousValue: { state: "OPEN" },
          newValue: { state: "BLOCKED", date: dateKey },
        },
        tx,
      );

      return { ok: true as const, value: { offeringId: offering.id, date: dateKey, state: "BLOCKED" as const } };
    });
    return result as RentalOfferingResult<BlockRentalDayResult>;
  } catch (error) {
    logger.error("blockRentalDay.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
