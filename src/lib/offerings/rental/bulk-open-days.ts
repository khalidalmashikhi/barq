import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parseOmanDateKey, isOmanPastDateKey, dbDateFromOmanDateKey, omanDateKeyFromDbDate } from "@/lib/date/oman-time";
import { isWithinMaxCalendarWindow, MAX_CALENDAR_WINDOW_DAYS } from "@/lib/offerings/calendar/offering-calendar-types";
import { resolveApprovedProvider, assertProviderStillApproved, loadOwnedRentalOffering, assertRentalEditAuthorized } from "./rental-offering-authorization";
import { isRentalOfferingArchived } from "./rental-offering-lifecycle";
import type { RentalBulkOpenSummary } from "./rental-offering-dto";
import type { RentalOfferingResult } from "./rental-offering-errors";

// Phase 3C Slice C2b-R — bulk-open Oman calendar days for a rental offering (mutation 6). The
// provider supplies an explicit list of YYYY-MM-DD dates to make bookable. Rules:
//   • strict Oman date keys; past dates rejected (fail-closed — history is immutable);
//   • the earliest→latest inclusive span must fit the shared MAX_CALENDAR_WINDOW_DAYS (62) window;
//   • runs atomically in ONE transaction;
//   • missing days are CREATED as OPEN; existing OPEN days are left untouched (overrides and
//     start-times preserved); existing BLOCKED days stay BLOCKED unless reopenBlocked === true;
//   • one bounded summary audit event (counts + window, never the raw date list).
// It never OPENs by side effect anywhere else and never deletes a row.

export type BulkOpenRentalDaysInput = {
  offeringId: string;
  /** Explicit Oman calendar date keys (YYYY-MM-DD) to open. */
  dates: string[];
  /** When true, existing BLOCKED days in the set are flipped back to OPEN. Default false. */
  reopenBlocked?: boolean;
};

export async function bulkOpenRentalDays(input: BulkOpenRentalDaysInput): Promise<RentalOfferingResult<RentalBulkOpenSummary>> {
  const auth = await resolveApprovedProvider();
  if (!auth.ok) return auth;
  const { providerId } = auth;
  if (!isValidUuid(input?.offeringId)) return { ok: false, error: "OFFERING_NOT_FOUND" };

  if (!Array.isArray(input?.dates) || input.dates.length === 0) return { ok: false, error: "INVALID_INPUT" };
  const reopenBlocked = input.reopenBlocked === true;

  // Normalize + validate each key; dedupe (a repeated date is one day). Reject any past date.
  const keys = new Set<string>();
  for (const raw of input.dates) {
    const key = parseOmanDateKey(raw);
    if (key === null) return { ok: false, error: "INVALID_DATE" };
    if (isOmanPastDateKey(key)) return { ok: false, error: "INVALID_DATE" };
    keys.add(key);
  }
  const dateKeys = [...keys].sort();

  // The inclusive earliest→latest span must fit the shared calendar window (also bounds the count).
  const minKey = dateKeys[0]!;
  const maxKey = dateKeys[dateKeys.length - 1]!;
  if (!isWithinMaxCalendarWindow(minKey, maxKey) || dateKeys.length > MAX_CALENDAR_WINDOW_DAYS) {
    return { ok: false, error: "DATE_WINDOW_TOO_LARGE" };
  }

  // Map each key to its zone-free @db.Date value (never applies the Oman offset).
  const dbDateByKey = new Map<string, Date>();
  for (const key of dateKeys) {
    const dbDate = dbDateFromOmanDateKey(key);
    if (dbDate === null) return { ok: false, error: "INVALID_DATE" };
    dbDateByKey.set(key, dbDate);
  }

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

      // Re-read the current state of these specific days inside the tx (TOCTOU-safe).
      const existing = await tx.rentalOfferingDay.findMany({
        where: { rentalOfferingId: offering.id, serviceDate: { in: [...dbDateByKey.values()] } },
        select: { serviceDate: true, state: true },
      });
      const stateByKey = new Map<string, "OPEN" | "BLOCKED">();
      for (const row of existing) stateByKey.set(omanDateKeyFromDbDate(row.serviceDate), row.state);

      const missingDates: Date[] = [];
      const blockedKeys: string[] = [];
      let alreadyOpen = 0;
      for (const key of dateKeys) {
        const state = stateByKey.get(key);
        if (state === undefined) missingDates.push(dbDateByKey.get(key)!);
        else if (state === "OPEN") alreadyOpen += 1;
        else blockedKeys.push(key);
      }

      // Create missing days as OPEN. skipDuplicates makes a concurrent insert of the same
      // (offering, date) a harmless no-op instead of a P2002 that rolls back the whole batch.
      const createdResult = missingDates.length
        ? await tx.rentalOfferingDay.createMany({
            data: missingDates.map((serviceDate) => ({ rentalOfferingId: offering.id, serviceDate, state: "OPEN" as const })),
            skipDuplicates: true,
          })
        : { count: 0 };

      // Reopen BLOCKED days only on explicit request; the updateMany is guarded on state BLOCKED.
      let opened = 0;
      if (reopenBlocked && blockedKeys.length) {
        const reopened = await tx.rentalOfferingDay.updateMany({
          where: { rentalOfferingId: offering.id, serviceDate: { in: blockedKeys.map((k) => dbDateByKey.get(k)!) }, state: "BLOCKED" },
          data: { state: "OPEN" },
        });
        opened = reopened.count;
      }

      const summary: RentalBulkOpenSummary = {
        created: createdResult.count,
        opened,
        alreadyOpen,
        blockedKept: reopenBlocked ? 0 : blockedKeys.length,
      };

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "rental_offering.days_opened",
          entityType: "RentalOffering",
          entityId: offering.id,
          newValue: {
            requested: dateKeys.length,
            fromDate: minKey,
            toDate: maxKey,
            reopenBlocked,
            created: summary.created,
            opened: summary.opened,
            alreadyOpen: summary.alreadyOpen,
            blockedKept: summary.blockedKept,
          },
        },
        tx,
      );

      return { ok: true as const, value: summary };
    });
    return result as RentalOfferingResult<RentalBulkOpenSummary>;
  } catch (error) {
    logger.error("bulkOpenRentalDays.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
