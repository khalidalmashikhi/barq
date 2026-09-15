import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { parseOfferingAmount, normalizeOfferingCurrency, checkCapacityOverride } from "./rental-offering-validation";
import {
  resolveApprovedProvider,
  loadOwnedServiceAndVehicleForCreate,
  assertRentalDraftAuthorized,
  isUniqueViolation,
} from "./rental-offering-authorization";
import { toRentalOfferingDTO, type RentalOfferingDTO } from "./rental-offering-dto";
import type { RentalOfferingErrorCode, RentalOfferingResult } from "./rental-offering-errors";

// Phase 3C Slice C2b-R — create a DRAFT rental offering. Provider identity is session-derived; a
// client status/provider id is never accepted. Ownership + VEHICLE_RENTAL service kind + a
// draft-eligible RENTAL_COMPANY vertical are all enforced. The C1 partial-unique index arbitrates
// "one non-ARCHIVED offering per (serviceId, vehicleId)" — a P2002 maps to OFFERING_ALREADY_ACTIVE.

export type CreateRentalOfferingInput = {
  serviceId: string;
  vehicleId: string;
  baseDailyAmount: string | number;
  currency: string;
  offeringCapacityOverride?: number | null;
};

export async function createRentalOffering(input: CreateRentalOfferingInput): Promise<RentalOfferingResult<RentalOfferingDTO>> {
  const auth = await resolveApprovedProvider();
  if (!auth.ok) return auth;
  const { providerId } = auth;

  if (!isValidUuid(input?.serviceId) || !isValidUuid(input?.vehicleId)) return { ok: false, error: "INVALID_INPUT" };

  const amount = parseOfferingAmount(input.baseDailyAmount);
  if (amount === null) return { ok: false, error: "INVALID_MONEY" };

  const currency = normalizeOfferingCurrency(input.currency);
  if (currency === null) return { ok: false, error: "INVALID_CURRENCY" };

  const override = input.offeringCapacityOverride ?? null;
  if (override !== null && (!Number.isInteger(override) || override <= 0)) {
    return { ok: false, error: "INVALID_CAPACITY_OVERRIDE" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const owned = await loadOwnedServiceAndVehicleForCreate(tx, providerId, input.serviceId, input.vehicleId);
      if (!owned.ok) return owned;

      const draftGate = await assertRentalDraftAuthorized(providerId);
      if (draftGate !== null) return { ok: false as const, error: draftGate };

      // Capacity override must fit the vehicle's verified bookable capacity when supplied.
      const capacity = checkCapacityOverride(owned.value.vehicle.bookablePassengerCapacity, override);
      if (!capacity.ok) return { ok: false as const, error: capacity.error };

      const created = await tx.rentalOffering.create({
        data: {
          serviceId: input.serviceId,
          vehicleId: input.vehicleId,
          baseDailyAmount: amount,
          currency,
          offeringCapacityOverride: override,
          status: "DRAFT",
        },
        select: {
          id: true,
          serviceId: true,
          vehicleId: true,
          status: true,
          baseDailyAmount: true,
          currency: true,
          offeringCapacityOverride: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "rental_offering.created",
          entityType: "RentalOffering",
          entityId: created.id,
          newValue: {
            serviceId: created.serviceId,
            vehicleId: created.vehicleId,
            baseDailyAmount: amount.toFixed(2),
            currency,
            offeringCapacityOverride: override,
            status: "DRAFT",
          },
        },
        tx,
      );

      return { ok: true as const, value: toRentalOfferingDTO(created, owned.value.vehicle.bookablePassengerCapacity) };
    });

    return result as RentalOfferingResult<RentalOfferingDTO>;
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "OFFERING_ALREADY_ACTIVE" };
    logger.error("createRentalOffering.unexpected_error", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" as RentalOfferingErrorCode };
  }
}
