import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parseOmanDateKey, isOmanPastDateKey, dbDateFromOmanDateKey } from "@/lib/date/oman-time";
import { isWithinMaxCalendarWindow, MAX_CALENDAR_WINDOW_DAYS } from "@/lib/offerings/calendar/offering-calendar-types";
import { resolveApprovedProvider, assertProviderStillApproved, loadOwnedRentalOffering, assertRentalEditAuthorized, type DbClient } from "./rental-offering-authorization";
import { isRentalOfferingArchived } from "./rental-offering-lifecycle";
import type { RentalOfferingErrorCode, RentalOfferingResult } from "./rental-offering-errors";

// Phase 3C Slice C2b-R — block rental days. Blocking is an explicit close. Per the approved contract
// it MAY create a missing OfferingDay directly as BLOCKED (fail-closed — a BLOCKED row is never
// customer-available), but it must NEVER create or transition a day to OPEN. Behavior per day:
//   • existing OPEN day   → state → BLOCKED (its override and start-times are preserved);
//   • existing BLOCKED day → idempotent no-op (no audit — the module's no-op convention);
//   • missing day         → create a new BLOCKED row (state=BLOCKED, dailyAmountOverride=null, no
//                           start-time records), race-safe via createMany({ skipDuplicates }).
// It never deletes an override or start-time history.
//
// C2d-R1 Checkpoint-B correction: the per-day logic is the shared `blockOneDayInTx` primitive so the
// SINGLE-day (`blockRentalDay`) and ATOMIC BATCH (`blockRentalDays`) paths enforce identical rules.
// The batch applies every selected date inside ONE interactive transaction with its audit events —
// all dates commit or all roll back (a per-day domain error throws, aborting the whole transaction).
// Provider identity is always session-derived (resolveApprovedProvider); a client never supplies
// providerId, offering ownership, current state, or authorization.

export type BlockRentalDayInput = {
  offeringId: string;
  /** The Oman calendar date key (YYYY-MM-DD) to block. */
  date: string;
};

export type BlockRentalDayOutcome = "created" | "changed" | "unchanged";
export type BlockRentalDayResult = { offeringId: string; date: string; state: "BLOCKED"; outcome: BlockRentalDayOutcome };

/** Batch summary: per-outcome counts + the total dates processed (all committed together). */
export type RentalBlockDaysSummary = { created: number; changed: number; unchanged: number; total: number };

export type BlockRentalDaysInput = {
  offeringId: string;
  /** Explicit Oman calendar date keys (YYYY-MM-DD) to block — normalized/deduped server-side. */
  dates: string[];
};

/** Carries a domain error code out of the batch transaction so throwing it rolls the whole tx back. */
class BatchBlockError extends Error {
  constructor(readonly code: RentalOfferingErrorCode) {
    super(code);
    this.name = "BatchBlockError";
  }
}

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
      const gate = await authorizeOfferingEdit(tx, providerId, input.offeringId);
      if (!gate.ok) return { ok: false as const, error: gate.error };
      return blockOneDayInTx(tx, providerId, gate.offeringId, dbDate, dateKey);
    });
    return result as RentalOfferingResult<BlockRentalDayResult>;
  } catch (error) {
    logger.error("blockRentalDay.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

/**
 * Atomic multi-date block (C2d-R1 Checkpoint B). The complete normalized, unique date set is validated
 * BEFORE any mutation; then every date is blocked inside ONE transaction and its audit recorded there,
 * so the operation commits all dates or rolls back all dates. Reuses the shared per-day primitive, so
 * missing→BLOCKED / OPEN→BLOCKED-preserving-override / already-BLOCKED-no-op behavior is identical to
 * the single-day path. Never trusts a client providerId / ownership / state.
 */
export async function blockRentalDays(input: BlockRentalDaysInput): Promise<RentalOfferingResult<RentalBlockDaysSummary>> {
  const auth = await resolveApprovedProvider();
  if (!auth.ok) return auth;
  const { providerId } = auth;
  if (!isValidUuid(input?.offeringId)) return { ok: false, error: "OFFERING_NOT_FOUND" };
  if (!Array.isArray(input?.dates) || input.dates.length === 0) return { ok: false, error: "INVALID_INPUT" };

  // Normalize + validate the COMPLETE set before mutating: dedupe, reject malformed/past, bound the
  // inclusive span to the shared calendar window. Any bad date → write nothing (no transaction opened).
  const keys = new Set<string>();
  for (const raw of input.dates) {
    const key = parseOmanDateKey(raw);
    if (key === null) return { ok: false, error: "INVALID_DATE" };
    if (isOmanPastDateKey(key)) return { ok: false, error: "INVALID_DATE" };
    keys.add(key);
  }
  const dateKeys = [...keys].sort();
  const minKey = dateKeys[0]!;
  const maxKey = dateKeys[dateKeys.length - 1]!;
  if (!isWithinMaxCalendarWindow(minKey, maxKey) || dateKeys.length > MAX_CALENDAR_WINDOW_DAYS) {
    return { ok: false, error: "DATE_WINDOW_TOO_LARGE" };
  }
  const dbDateByKey = new Map<string, Date>();
  for (const key of dateKeys) {
    const dbDate = dbDateFromOmanDateKey(key);
    if (dbDate === null) return { ok: false, error: "INVALID_DATE" };
    dbDateByKey.set(key, dbDate);
  }

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const gate = await authorizeOfferingEdit(tx, providerId, input.offeringId);
      if (!gate.ok) throw new BatchBlockError(gate.error);

      const acc: RentalBlockDaysSummary = { created: 0, changed: 0, unchanged: 0, total: dateKeys.length };
      for (const key of dateKeys) {
        const dayResult = await blockOneDayInTx(tx, providerId, gate.offeringId, dbDateByKey.get(key)!, key);
        if (!dayResult.ok) throw new BatchBlockError(dayResult.error); // aborts + rolls back EVERY date
        acc[dayResult.value.outcome] += 1;
      }
      return acc;
    });
    return { ok: true, value: summary };
  } catch (error) {
    if (error instanceof BatchBlockError) return { ok: false, error: error.code };
    logger.error("blockRentalDays.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

/** Shared TOCTOU-safe offering-edit gate (provider approval + ownership + kind + lifecycle + vertical). */
async function authorizeOfferingEdit(
  tx: DbClient,
  providerId: string,
  offeringId: string,
): Promise<{ ok: true; offeringId: string } | { ok: false; error: RentalOfferingErrorCode }> {
  const providerGate = await assertProviderStillApproved(tx, providerId);
  if (providerGate !== null) return { ok: false, error: providerGate };
  const offering = await loadOwnedRentalOffering(tx, providerId, offeringId);
  if (!offering) return { ok: false, error: "OFFERING_NOT_FOUND" };
  if (isRentalOfferingArchived(offering.status)) return { ok: false, error: "OFFERING_ARCHIVED" };
  if (offering.serviceOfferingKind !== "VEHICLE_RENTAL") return { ok: false, error: "WRONG_SERVICE_KIND" };
  const editGate = await assertRentalEditAuthorized(tx, providerId, offering);
  if (editGate !== null) return { ok: false, error: editGate };
  return { ok: true, offeringId: offering.id };
}

/**
 * Block ONE day inside an already-open, already-authorized transaction. Identical rules for the single
 * and batch paths. Missing→create BLOCKED (race-safe), OPEN→BLOCKED (guarded, override/start-times
 * preserved), already-BLOCKED→idempotent no-op. Never raises a raw unique violation.
 */
async function blockOneDayInTx(
  tx: DbClient,
  providerId: string,
  offeringId: string,
  dbDate: Date,
  dateKey: string,
): Promise<{ ok: true; value: BlockRentalDayResult } | { ok: false; error: RentalOfferingErrorCode }> {
  const day = await tx.rentalOfferingDay.findUnique({
    where: { rentalOfferingId_serviceDate: { rentalOfferingId: offeringId, serviceDate: dbDate } },
    select: { id: true, state: true },
  });

  if (day) {
    if (day.state === "BLOCKED") return okResult(offeringId, dateKey, "unchanged");
    return blockExistingOpenDay(tx, providerId, offeringId, dateKey, day.id);
  }

  const created = await tx.rentalOfferingDay.createMany({
    data: [{ rentalOfferingId: offeringId, serviceDate: dbDate, state: "BLOCKED", dailyAmountOverride: null }],
    skipDuplicates: true,
  });
  if (created.count === 1) {
    await recordAuditEvent(
      {
        actorType: "PROVIDER",
        actorId: providerId,
        action: "rental_offering.day_created_blocked",
        entityType: "RentalOfferingDay",
        entityId: offeringId, // the day id is DB-generated; scope the audit to the offering + date
        newValue: { date: dateKey, state: "BLOCKED", dailyAmountOverride: null },
      },
      tx,
    );
    return okResult(offeringId, dateKey, "created");
  }

  // count 0 → a concurrent writer created the row first (its override untouched by our skip).
  const raced = await tx.rentalOfferingDay.findUnique({
    where: { rentalOfferingId_serviceDate: { rentalOfferingId: offeringId, serviceDate: dbDate } },
    select: { id: true, state: true },
  });
  if (!raced) return { ok: false, error: "OFFERING_STATE_CONFLICT" };
  if (raced.state === "BLOCKED") return okResult(offeringId, dateKey, "unchanged"); // converged
  return blockExistingOpenDay(tx, providerId, offeringId, dateKey, raced.id);
}

function okResult(offeringId: string, date: string, outcome: BlockRentalDayOutcome): { ok: true; value: BlockRentalDayResult } {
  return { ok: true, value: { offeringId, date, state: "BLOCKED", outcome } };
}

/**
 * Flip a known-OPEN day to BLOCKED, guarded on state=OPEN so a concurrent transition can't be
 * overwritten (the override + start-times, which we never touch, are preserved). A lost guard that
 * finds the row already BLOCKED converges to an idempotent no-op; anything else conflicts.
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
