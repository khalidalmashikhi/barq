import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parseOmanDateKey, dbDateFromOmanDateKey } from "@/lib/date/oman-time";
import { resolveApprovedProvider, assertProviderStillApproved, loadOwnedRentalOffering, assertRentalEditAuthorized, type DbClient } from "./rental-offering-authorization";
import { isRentalOfferingArchived } from "./rental-offering-lifecycle";
import type { RentalOfferingErrorCode, RentalOfferingResult } from "./rental-offering-errors";

// Phase 3C Slice C2b-R — block a single rental day (mutation 7). Blocking is an explicit close.
// Per the approved contract it MAY create a missing OfferingDay directly as BLOCKED (fail-closed —
// a BLOCKED row is never customer-available), but it must NEVER create or transition a day to OPEN.
// Behavior:
//   • existing OPEN day   → state → BLOCKED (its override and start-times are preserved);
//   • existing BLOCKED day → idempotent no-op (no audit — the module's no-op convention, matching
//     the already-in-state lifecycle transitions);
//   • missing day         → create a new BLOCKED row (offering id + validated serviceDate,
//     state=BLOCKED, dailyAmountOverride=null, no start-time records).
// It never deletes an override or start-time history.
//
// Concurrency: the missing-day create is a `createMany({ skipDuplicates })`, which emits
// `INSERT ... ON CONFLICT DO NOTHING` against the (rentalOfferingId, serviceDate) unique index — so
// two concurrent block-the-same-missing-day requests never raise a raw unique violation (which would
// also poison the interactive transaction). `count === 0` means a concurrent writer created the row
// first: we re-read and converge on its BLOCKED state, and because the conflicting insert did
// nothing, a concurrently-created row's override is never overwritten.

export type BlockRentalDayInput = {
  offeringId: string;
  /** The Oman calendar date key (YYYY-MM-DD) to block. */
  date: string;
};

export type BlockRentalDayOutcome = "created" | "changed" | "unchanged";
export type BlockRentalDayResult = { offeringId: string; date: string; state: "BLOCKED"; outcome: BlockRentalDayOutcome };

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
      // Re-read the provider's mutable approval status inside the write transaction (TOCTOU-safe).
      const providerGate = await assertProviderStillApproved(tx, providerId);
      if (providerGate !== null) return { ok: false as const, error: providerGate };

      const offering = await loadOwnedRentalOffering(tx, providerId, input.offeringId);
      if (!offering) return { ok: false as const, error: "OFFERING_NOT_FOUND" as const };
      if (isRentalOfferingArchived(offering.status)) return { ok: false as const, error: "OFFERING_ARCHIVED" as const };
      if (offering.serviceOfferingKind !== "VEHICLE_RENTAL") return { ok: false as const, error: "WRONG_SERVICE_KIND" as const };

      const editGate = await assertRentalEditAuthorized(tx, providerId, offering);
      if (editGate !== null) return { ok: false as const, error: editGate };

      const day = await tx.rentalOfferingDay.findUnique({
        where: { rentalOfferingId_serviceDate: { rentalOfferingId: offering.id, serviceDate: dbDate } },
        select: { id: true, state: true },
      });

      // Existing day: idempotent when already BLOCKED, otherwise flip OPEN → BLOCKED.
      if (day) {
        if (day.state === "BLOCKED") return okResult(offering.id, dateKey, "unchanged");
        return blockExistingOpenDay(tx, providerId, offering.id, dateKey, day.id);
      }

      // Missing day: race-safe create-as-BLOCKED via ON CONFLICT DO NOTHING.
      const created = await tx.rentalOfferingDay.createMany({
        data: [{ rentalOfferingId: offering.id, serviceDate: dbDate, state: "BLOCKED", dailyAmountOverride: null }],
        skipDuplicates: true,
      });
      if (created.count === 1) {
        await recordAuditEvent(
          {
            actorType: "PROVIDER",
            actorId: providerId,
            action: "rental_offering.day_created_blocked",
            entityType: "RentalOfferingDay",
            entityId: offering.id, // the day id is DB-generated; scope the audit to the offering + date
            newValue: { date: dateKey, state: "BLOCKED", dailyAmountOverride: null },
          },
          tx,
        );
        return okResult(offering.id, dateKey, "created");
      }

      // count 0 → a concurrent writer created the row first (its override untouched by our skip).
      const raced = await tx.rentalOfferingDay.findUnique({
        where: { rentalOfferingId_serviceDate: { rentalOfferingId: offering.id, serviceDate: dbDate } },
        select: { id: true, state: true },
      });
      if (!raced) return { ok: false as const, error: "OFFERING_STATE_CONFLICT" as const };
      if (raced.state === "BLOCKED") return okResult(offering.id, dateKey, "unchanged"); // converged
      return blockExistingOpenDay(tx, providerId, offering.id, dateKey, raced.id);
    });
    return result as RentalOfferingResult<BlockRentalDayResult>;
  } catch (error) {
    logger.error("blockRentalDay.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

function okResult(offeringId: string, date: string, outcome: BlockRentalDayOutcome): { ok: true; value: BlockRentalDayResult } {
  return { ok: true, value: { offeringId, date, state: "BLOCKED", outcome } };
}

/**
 * Flip a known-OPEN day to BLOCKED, guarded on state=OPEN so a concurrent transition can't be
 * overwritten (and the override + start-times, which we never touch, are preserved). A lost guard
 * that finds the row already BLOCKED converges to an idempotent no-op; anything else conflicts.
 */
async function blockExistingOpenDay(
  tx: DbClient,
  providerId: string,
  offeringId: string,
  dateKey: string,
  dayId: string,
): Promise<{ ok: true; value: BlockRentalDayResult } | { ok: false; error: RentalOfferingErrorCode }> {
  const updated = await tx.rentalOfferingDay.updateMany({ where: { id: dayId, state: "OPEN" }, data: { state: "BLOCKED" } });
  if (updated.count === 0) {
    const reread = await tx.rentalOfferingDay.findUnique({ where: { id: dayId }, select: { state: true } });
    if (reread?.state === "BLOCKED") return okResult(offeringId, dateKey, "unchanged");
    return { ok: false, error: "OFFERING_STATE_CONFLICT" };
  }
  await recordAuditEvent(
    {
      actorType: "PROVIDER",
      actorId: providerId,
      action: "rental_offering.day_blocked",
      entityType: "RentalOfferingDay",
      entityId: dayId,
      previousValue: { state: "OPEN" },
      newValue: { state: "BLOCKED", date: dateKey },
    },
    tx,
  );
  return okResult(offeringId, dateKey, "changed");
}
