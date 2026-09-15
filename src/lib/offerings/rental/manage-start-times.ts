import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parseOmanDateKey, dbDateFromOmanDateKey } from "@/lib/date/oman-time";
import { resolveApprovedProvider, assertProviderStillApproved, loadOwnedRentalOffering, assertRentalEditAuthorized } from "./rental-offering-authorization";
import { isRentalOfferingArchived } from "./rental-offering-lifecycle";
import type { RentalStartTimesSummary } from "./rental-offering-dto";
import type { RentalOfferingResult } from "./rental-offering-errors";

// Phase 3C Slice C2b-R — manage a day's operational start (pickup) times (mutation 9). The caller
// supplies the DESIRED set of OPEN start times (Oman-local minutes-from-midnight) for one existing
// day. This is DECLARATIVE and a STATE CHANGE, never a delete: minutes in the set become/stay OPEN
// (creating a row or reopening a CLOSED one), and minutes currently OPEN but absent from the set are
// flipped to CLOSED (their rows are retained for history). An empty desired set is valid and closes
// every open time. Start times are operational only — they never change the daily billing unit.
//
// MAX_START_TIMES_PER_DAY = 48: a bounded safety limit of at most 48 CONFIGURED start-time entries
// per offering day. This is purely a count ceiling — it does NOT impose any spacing between the
// chosen minutes (a provider may set any 48 arbitrary values in 0–1439). The cap bounds per-day row
// growth and keeps the summary audit event bounded; more than 48 indicates malformed input, not a
// real operational schedule. (Any fixed-increment scheduling would be a separately approved change.)
export const MAX_START_TIMES_PER_DAY = 48;
const MIN_START_MINUTE = 0;
const MAX_START_MINUTE = 1439;

export type ManageStartTimesInput = {
  offeringId: string;
  /** The Oman calendar date key (YYYY-MM-DD) of an existing day. */
  date: string;
  /** The desired set of OPEN start times, as unique Oman-local minutes-from-midnight (0–1439). */
  startTimeMinutes: number[];
};

export async function manageStartTimes(input: ManageStartTimesInput): Promise<RentalOfferingResult<RentalStartTimesSummary>> {
  const auth = await resolveApprovedProvider();
  if (!auth.ok) return auth;
  const { providerId } = auth;
  if (!isValidUuid(input?.offeringId)) return { ok: false, error: "OFFERING_NOT_FOUND" };

  const dateKey = parseOmanDateKey(input?.date);
  const dbDate = dateKey === null ? null : dbDateFromOmanDateKey(dateKey);
  if (dateKey === null || dbDate === null) return { ok: false, error: "INVALID_DATE" };

  if (!Array.isArray(input?.startTimeMinutes)) return { ok: false, error: "INVALID_INPUT" };
  // Validate + dedupe the desired minutes (a repeated minute is one start time).
  const desired = new Set<number>();
  for (const m of input.startTimeMinutes) {
    if (!Number.isInteger(m) || m < MIN_START_MINUTE || m > MAX_START_MINUTE) return { ok: false, error: "INVALID_START_TIME" };
    desired.add(m);
  }
  if (desired.size > MAX_START_TIMES_PER_DAY) return { ok: false, error: "INVALID_START_TIME" };

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

      // The day must already exist; managing start times never creates or opens a day.
      const day = await tx.rentalOfferingDay.findUnique({
        where: { rentalOfferingId_serviceDate: { rentalOfferingId: offering.id, serviceDate: dbDate } },
        select: { id: true },
      });
      if (!day) return { ok: false as const, error: "OFFERING_DAY_NOT_FOUND" as const };

      const existing = await tx.rentalStartTime.findMany({
        where: { rentalOfferingDayId: day.id },
        select: { startTimeMinutes: true, state: true },
      });
      const existingMinutes = new Set(existing.map((r) => r.startTimeMinutes));
      const openMinutes = new Set(existing.filter((r) => r.state === "OPEN").map((r) => r.startTimeMinutes));

      const toCreate = [...desired].filter((m) => !existingMinutes.has(m)); // no row yet → create OPEN
      const toReopen = [...desired].filter((m) => existingMinutes.has(m) && !openMinutes.has(m)); // CLOSED → OPEN
      const toClose = [...openMinutes].filter((m) => !desired.has(m)); // OPEN but no longer desired → CLOSED
      const unchanged = [...desired].filter((m) => openMinutes.has(m)).length;

      let opened = 0;
      if (toCreate.length) {
        const created = await tx.rentalStartTime.createMany({
          data: toCreate.map((startTimeMinutes) => ({ rentalOfferingDayId: day.id, startTimeMinutes, state: "OPEN" as const })),
          skipDuplicates: true,
        });
        opened += created.count;
      }
      if (toReopen.length) {
        const reopened = await tx.rentalStartTime.updateMany({
          where: { rentalOfferingDayId: day.id, startTimeMinutes: { in: toReopen }, state: "CLOSED" },
          data: { state: "OPEN" },
        });
        opened += reopened.count;
      }
      let closed = 0;
      if (toClose.length) {
        const closedRes = await tx.rentalStartTime.updateMany({
          where: { rentalOfferingDayId: day.id, startTimeMinutes: { in: toClose }, state: "OPEN" },
          data: { state: "CLOSED" },
        });
        closed = closedRes.count;
      }

      const summary: RentalStartTimesSummary = { opened, closed, unchanged };

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "rental_offering.day_start_times_set",
          entityType: "RentalOfferingDay",
          entityId: day.id,
          newValue: { date: dateKey, desired: desired.size, opened, closed, unchanged },
        },
        tx,
      );

      return { ok: true as const, value: summary };
    });
    return result as RentalOfferingResult<RentalStartTimesSummary>;
  } catch (error) {
    logger.error("manageStartTimes.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
