import "server-only";
import type { RentalOfferingStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { omanDateKey } from "@/lib/date/oman-time";
import { resolveApprovedProvider, assertProviderStillApproved, loadOwnedRentalOffering, assertRentalPublishReady, type LoadedRentalOffering } from "./rental-offering-authorization";
import { isRentalOfferingArchived } from "./rental-offering-lifecycle";
import { toRentalOfferingDTO, type RentalOfferingDTO } from "./rental-offering-dto";
import type { RentalOfferingResult } from "./rental-offering-errors";

// Phase 3C Slice C2b-R — the offering lifecycle transitions (publish / suspend / archive). Each uses
// a GUARDED updateMany on the expected prior status so concurrent transitions cannot both win (loser
// → OFFERING_STATE_CONFLICT), keeps its audit event in the same transaction, and never deletes rows.
//
// PUBLISH decision (verified from code): offering-publish does NOT require the Service to be
// Service.status = PUBLISHED. assertServicePublishable requires an ACTIVE Price row (NO_ACTIVE_PRICE),
// which a daily-priced rental Service deliberately lacks — coupling would deadlock daily rentals.
// Customer visibility (Service PUBLISHED + provider APPROVED/visible) is enforced later at the C2c
// calendar READ (fail-closed); the offering's own publish gate enforces vertical compliance, vehicle
// selectability, verified capacity, and >= 1 explicit OPEN non-past day with a resolvable price.

function dtoFromLoaded(loaded: LoadedRentalOffering, status: RentalOfferingStatus): RentalOfferingDTO {
  return toRentalOfferingDTO(
    {
      id: loaded.id,
      serviceId: loaded.serviceId,
      vehicleId: loaded.vehicleId,
      status,
      baseDailyAmount: loaded.baseDailyAmount,
      currency: loaded.currency,
      offeringCapacityOverride: loaded.offeringCapacityOverride,
      createdAt: loaded.createdAt,
      updatedAt: new Date(),
    },
    loaded.vehicle.bookablePassengerCapacity,
  );
}

/** Start of today's Oman calendar day as the UTC-midnight instant matching a @db.Date value. */
function todayOmanDateBoundary(now: Date): Date {
  return new Date(`${omanDateKey(now)}T00:00:00.000Z`);
}

// DRAFT → PUBLISHED | SUSPENDED → PUBLISHED. Full readiness re-checked inside the tx.
export async function publishRentalOffering(offeringId: string, now: Date = new Date()): Promise<RentalOfferingResult<RentalOfferingDTO>> {
  const auth = await resolveApprovedProvider();
  if (!auth.ok) return auth;
  const { providerId } = auth;
  if (!isValidUuid(offeringId)) return { ok: false, error: "OFFERING_NOT_FOUND" };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read the provider's mutable approval status inside the write transaction (TOCTOU-safe).
      const providerGate = await assertProviderStillApproved(tx, providerId);
      if (providerGate !== null) return { ok: false as const, error: providerGate };

      const offering = await loadOwnedRentalOffering(tx, providerId, offeringId);
      if (!offering) return { ok: false as const, error: "OFFERING_NOT_FOUND" as const };
      if (isRentalOfferingArchived(offering.status)) return { ok: false as const, error: "OFFERING_ARCHIVED" as const };
      if (offering.serviceOfferingKind !== "VEHICLE_RENTAL") return { ok: false as const, error: "WRONG_SERVICE_KIND" as const };
      if (offering.status === "PUBLISHED") return { ok: true as const, value: dtoFromLoaded(offering, "PUBLISHED") }; // idempotent no-op

      // Full publish readiness (vertical compliant + vehicle selectable + verified capacity).
      const ready = await assertRentalPublishReady(tx, providerId, offering.vehicle, now);
      if (ready !== null) return { ok: false as const, error: ready };

      // >= 1 explicit OPEN, non-past day (an OPEN day always resolves a price: override ?? positive base).
      const publishableDay = await tx.rentalOfferingDay.findFirst({
        where: { rentalOfferingId: offeringId, state: "OPEN", serviceDate: { gte: todayOmanDateBoundary(now) } },
        select: { id: true },
      });
      if (!publishableDay) return { ok: false as const, error: "NO_PUBLISHABLE_DAY" as const };

      const updated = await tx.rentalOffering.updateMany({
        where: { id: offeringId, status: { in: ["DRAFT", "SUSPENDED"] } },
        data: { status: "PUBLISHED" },
      });
      if (updated.count === 0) return { ok: false as const, error: "OFFERING_STATE_CONFLICT" as const };

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: providerId,
          action: "rental_offering.published",
          entityType: "RentalOffering",
          entityId: offeringId,
          previousValue: { status: offering.status },
          newValue: { status: "PUBLISHED" },
        },
        tx,
      );
      return { ok: true as const, value: dtoFromLoaded(offering, "PUBLISHED") };
    });
    return result as RentalOfferingResult<RentalOfferingDTO>;
  } catch (error) {
    logger.error("publishRentalOffering.unexpected_error", { providerId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

// PUBLISHED → SUSPENDED (idempotent no-op if already SUSPENDED).
export async function suspendRentalOffering(offeringId: string): Promise<RentalOfferingResult<RentalOfferingDTO>> {
  return transitionSimple(offeringId, "SUSPENDED", ["PUBLISHED"], "rental_offering.suspended");
}

// DRAFT | PUBLISHED | SUSPENDED → ARCHIVED (terminal; idempotent no-op if already ARCHIVED).
export async function archiveRentalOffering(offeringId: string): Promise<RentalOfferingResult<RentalOfferingDTO>> {
  return transitionSimple(offeringId, "ARCHIVED", ["DRAFT", "PUBLISHED", "SUSPENDED"], "rental_offering.archived");
}

async function transitionSimple(
  offeringId: string,
  target: RentalOfferingStatus,
  allowedFrom: RentalOfferingStatus[],
  action: "rental_offering.suspended" | "rental_offering.archived",
): Promise<RentalOfferingResult<RentalOfferingDTO>> {
  const auth = await resolveApprovedProvider();
  if (!auth.ok) return auth;
  const { providerId } = auth;
  if (!isValidUuid(offeringId)) return { ok: false, error: "OFFERING_NOT_FOUND" };

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read the provider's mutable approval status inside the write transaction (TOCTOU-safe).
      const providerGate = await assertProviderStillApproved(tx, providerId);
      if (providerGate !== null) return { ok: false as const, error: providerGate };

      const offering = await loadOwnedRentalOffering(tx, providerId, offeringId);
      if (!offering) return { ok: false as const, error: "OFFERING_NOT_FOUND" as const };
      // ARCHIVED is terminal: re-archiving is an idempotent no-op; anything else on it is immutable.
      if (isRentalOfferingArchived(offering.status)) {
        return target === "ARCHIVED"
          ? { ok: true as const, value: dtoFromLoaded(offering, "ARCHIVED") }
          : { ok: false as const, error: "OFFERING_ARCHIVED" as const };
      }
      if (offering.status === target) return { ok: true as const, value: dtoFromLoaded(offering, target) }; // idempotent no-op

      const updated = await tx.rentalOffering.updateMany({
        where: { id: offeringId, status: { in: allowedFrom } },
        data: { status: target },
      });
      if (updated.count === 0) return { ok: false as const, error: "OFFERING_STATE_CONFLICT" as const };

      await recordAuditEvent(
        { actorType: "PROVIDER", actorId: providerId, action, entityType: "RentalOffering", entityId: offeringId, previousValue: { status: offering.status }, newValue: { status: target } },
        tx,
      );
      return { ok: true as const, value: dtoFromLoaded(offering, target) };
    });
    return result as RentalOfferingResult<RentalOfferingDTO>;
  } catch (error) {
    logger.error("transitionRentalOffering.unexpected_error", { providerId, offeringId, target, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
