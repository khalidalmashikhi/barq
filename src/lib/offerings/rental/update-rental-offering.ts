import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parseOfferingAmount, normalizeOfferingCurrency, checkCapacityOverride } from "./rental-offering-validation";
import {
  resolveApprovedProvider,
  loadOwnedRentalOffering,
  assertRentalDraftAuthorized,
  assertRentalPublishReady,
} from "./rental-offering-authorization";
import { isRentalOfferingArchived, rentalEditRequiresLiveCompliance } from "./rental-offering-lifecycle";
import { toRentalOfferingDTO, type RentalOfferingDTO } from "./rental-offering-dto";
import type { RentalOfferingErrorCode, RentalOfferingResult } from "./rental-offering-errors";

// Phase 3C Slice C2b-R — change a rental offering's COMMERCIAL fields (base daily amount, currency,
// capacity override). serviceId/vehicleId are immutable (there is no re-parent mutation). A PUBLISHED
// edit re-runs full live compliance; a DRAFT/SUSPENDED edit requires a valid draft-eligible vertical.
// Currency may change ONLY while DRAFT and ONLY when no day carries a price override.

export type UpdateRentalOfferingInput = {
  offeringId: string;
  /** Omit to leave unchanged. */
  baseDailyAmount?: string | number;
  /** Omit to leave unchanged; changing currency is DRAFT-only + requires no day overrides. */
  currency?: string;
  /** undefined = leave unchanged; null = clear (use verified capacity); number = set a stricter cap. */
  offeringCapacityOverride?: number | null;
};

export async function updateRentalOffering(input: UpdateRentalOfferingInput): Promise<RentalOfferingResult<RentalOfferingDTO>> {
  const auth = await resolveApprovedProvider();
  if (!auth.ok) return auth;
  const { providerId } = auth;
  if (!isValidUuid(input?.offeringId)) return { ok: false, error: "OFFERING_NOT_FOUND" };

  const changesAmount = input.baseDailyAmount !== undefined;
  const changesCurrency = input.currency !== undefined;
  const changesOverride = input.offeringCapacityOverride !== undefined;
  if (!changesAmount && !changesCurrency && !changesOverride) return { ok: false, error: "INVALID_INPUT" };

  // Pre-validate the pure/format aspects before any DB work.
  let newAmount: Prisma.Decimal | null = null;
  if (changesAmount) {
    newAmount = parseOfferingAmount(input.baseDailyAmount);
    if (newAmount === null) return { ok: false, error: "INVALID_MONEY" };
  }
  let newCurrency: string | null = null;
  if (changesCurrency) {
    newCurrency = normalizeOfferingCurrency(input.currency);
    if (newCurrency === null) return { ok: false, error: "INVALID_CURRENCY" };
  }
  const newOverride = changesOverride ? input.offeringCapacityOverride ?? null : undefined; // null = clear

  try {
    const result = await prisma.$transaction(async (tx) => {
      const offering = await loadOwnedRentalOffering(tx, providerId, input.offeringId);
      if (!offering) return { ok: false as const, error: "OFFERING_NOT_FOUND" as const };
      if (isRentalOfferingArchived(offering.status)) return { ok: false as const, error: "OFFERING_ARCHIVED" as const };
      if (offering.serviceOfferingKind !== "VEHICLE_RENTAL") return { ok: false as const, error: "WRONG_SERVICE_KIND" as const };

      // Authorization by lifecycle: PUBLISHED edits require full live compliance; DRAFT/SUSPENDED
      // require a valid, draft-eligible RENTAL_COMPANY vertical identity.
      if (rentalEditRequiresLiveCompliance(offering.status)) {
        const ready = await assertRentalPublishReady(tx, providerId, offering.vehicle);
        if (ready !== null) return { ok: false as const, error: ready };
      } else {
        const draftGate = await assertRentalDraftAuthorized(providerId);
        if (draftGate !== null) return { ok: false as const, error: draftGate };
      }

      // Currency rule: DRAFT-only, and only when no day carries a price override.
      if (changesCurrency) {
        if (offering.status !== "DRAFT") return { ok: false as const, error: "CURRENCY_LOCKED" as const };
        const overriddenDay = await tx.rentalOfferingDay.findFirst({
          where: { rentalOfferingId: offering.id, dailyAmountOverride: { not: null } },
          select: { id: true },
        });
        if (overriddenDay) return { ok: false as const, error: "CURRENCY_OVERRIDES_PRESENT" as const };
      }

      // Capacity override validation against the vehicle's verified bookable capacity.
      let resolvedOverride = offering.offeringCapacityOverride;
      if (changesOverride) {
        const capacity = checkCapacityOverride(offering.vehicle.bookablePassengerCapacity, newOverride ?? null);
        if (!capacity.ok) return { ok: false as const, error: capacity.error };
        resolvedOverride = newOverride ?? null;
      }

      const data: Prisma.RentalOfferingUpdateManyMutationInput = {};
      if (changesAmount) data.baseDailyAmount = newAmount!;
      if (changesCurrency) data.currency = newCurrency!;
      if (changesOverride) data.offeringCapacityOverride = newOverride ?? null;

      // Guarded on the current status so a concurrent transition (e.g. archive) can't be overwritten.
      const updated = await tx.rentalOffering.updateMany({ where: { id: offering.id, status: offering.status }, data });
      if (updated.count === 0) return { ok: false as const, error: "OFFERING_STATE_CONFLICT" as const };

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "rental_offering.updated",
          entityType: "RentalOffering",
          entityId: offering.id,
          previousValue: {
            ...(changesAmount ? { baseDailyAmount: offering.baseDailyAmount.toFixed(2) } : {}),
            ...(changesCurrency ? { currency: offering.currency } : {}),
            ...(changesOverride ? { offeringCapacityOverride: offering.offeringCapacityOverride } : {}),
          },
          newValue: {
            ...(changesAmount ? { baseDailyAmount: newAmount!.toFixed(2) } : {}),
            ...(changesCurrency ? { currency: newCurrency! } : {}),
            ...(changesOverride ? { offeringCapacityOverride: newOverride ?? null } : {}),
          },
        },
        tx,
      );

      return {
        ok: true as const,
        value: toRentalOfferingDTO(
          {
            id: offering.id,
            serviceId: offering.serviceId,
            vehicleId: offering.vehicleId,
            status: offering.status,
            baseDailyAmount: changesAmount ? newAmount! : offering.baseDailyAmount,
            currency: changesCurrency ? newCurrency! : offering.currency,
            offeringCapacityOverride: resolvedOverride,
            createdAt: offering.createdAt,
            updatedAt: new Date(),
          },
          offering.vehicle.bookablePassengerCapacity,
        ),
      };
    });
    return result as RentalOfferingResult<RentalOfferingDTO>;
  } catch (error) {
    logger.error("updateRentalOffering.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" as RentalOfferingErrorCode };
  }
}
