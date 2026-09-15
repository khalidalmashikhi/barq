import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parseOmanDateKey, dbDateFromOmanDateKey } from "@/lib/date/oman-time";
import { parseOfferingAmount } from "./rental-offering-validation";
import { resolveApprovedProvider, assertProviderStillApproved, loadOwnedRentalOffering, assertRentalEditAuthorized } from "./rental-offering-authorization";
import { isRentalOfferingArchived } from "./rental-offering-lifecycle";
import type { RentalOfferingResult } from "./rental-offering-errors";

// Phase 3C Slice C2b-R — set or clear a single day's price override (mutation 8). The OfferingDay
// row MUST already exist (→ OFFERING_DAY_NOT_FOUND); submitting an override NEVER creates or OPENs a
// day. The override carries no currency of its own — it is expressed in the offering currency and
// simply WINS over the base daily amount for that day. `dailyAmountOverride: null` clears it (the
// day falls back to the offering base). A cleared/set override never changes the day's OPEN/BLOCKED
// state. Money follows the same 2dp / ROUND_HALF_UP / positive contract as the base amount.

export type SetDailyOverrideInput = {
  offeringId: string;
  /** The Oman calendar date key (YYYY-MM-DD) whose override is being set/cleared. */
  date: string;
  /** A positive 2dp money string/number to set; null to clear (fall back to the offering base). */
  dailyAmountOverride: string | number | null;
};

export type DailyOverrideResult = { offeringId: string; date: string; dailyAmountOverride: string | null };

export async function setDailyOverride(input: SetDailyOverrideInput): Promise<RentalOfferingResult<DailyOverrideResult>> {
  const auth = await resolveApprovedProvider();
  if (!auth.ok) return auth;
  const { providerId } = auth;
  if (!isValidUuid(input?.offeringId)) return { ok: false, error: "OFFERING_NOT_FOUND" };

  const dateKey = parseOmanDateKey(input?.date);
  const dbDate = dateKey === null ? null : dbDateFromOmanDateKey(dateKey);
  if (dateKey === null || dbDate === null) return { ok: false, error: "INVALID_DATE" };

  // null → clear; otherwise validate as positive 2dp money before any DB work.
  const clearing = input.dailyAmountOverride === null;
  let newOverride: Prisma.Decimal | null = null;
  if (!clearing) {
    newOverride = parseOfferingAmount(input.dailyAmountOverride);
    if (newOverride === null) return { ok: false, error: "INVALID_MONEY" };
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

      // The day must already exist; an override never auto-creates or opens a day.
      const day = await tx.rentalOfferingDay.findUnique({
        where: { rentalOfferingId_serviceDate: { rentalOfferingId: offering.id, serviceDate: dbDate } },
        select: { id: true, dailyAmountOverride: true },
      });
      if (!day) return { ok: false as const, error: "OFFERING_DAY_NOT_FOUND" as const };

      // Guarded on the exact prior override so a concurrent override write cannot be overwritten.
      const priorFilter = day.dailyAmountOverride === null ? { dailyAmountOverride: null } : { dailyAmountOverride: day.dailyAmountOverride };
      const updated = await tx.rentalOfferingDay.updateMany({
        where: { id: day.id, ...priorFilter },
        data: { dailyAmountOverride: newOverride },
      });
      if (updated.count === 0) return { ok: false as const, error: "OFFERING_STATE_CONFLICT" as const };

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: clearing ? "rental_offering.day_override_cleared" : "rental_offering.day_override_set",
          entityType: "RentalOfferingDay",
          entityId: day.id,
          previousValue: { date: dateKey, dailyAmountOverride: day.dailyAmountOverride === null ? null : day.dailyAmountOverride.toFixed(2) },
          newValue: { date: dateKey, dailyAmountOverride: newOverride === null ? null : newOverride.toFixed(2) },
        },
        tx,
      );

      return {
        ok: true as const,
        value: { offeringId: offering.id, date: dateKey, dailyAmountOverride: newOverride === null ? null : newOverride.toFixed(2) },
      };
    });
    return result as RentalOfferingResult<DailyOverrideResult>;
  } catch (error) {
    logger.error("setDailyOverride.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
