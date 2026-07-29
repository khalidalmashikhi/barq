"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { AvailabilityActionErrorCode } from "./availability-action-errors";

// Create Availability Slot — Phase 4.2 (Provider Experience),
// Priority 2. Mirrors create-service.ts's shape: "use server",
// requireProvider(), server-side re-validation of everything
// (never trust client input), a single Prisma write.
//
// A new slot always starts OPEN with bookedCount 0 (schema defaults) —
// this action never accepts either as input.

export type CreateAvailabilitySlotResult = { ok: true } | { ok: false; error: AvailabilityActionErrorCode };

export async function createAvailabilitySlot(formData: FormData): Promise<CreateAvailabilitySlotResult> {
  const serviceId = formData.get("serviceId");
  const startTimeRaw = formData.get("startTime");
  const endTimeRaw = formData.get("endTime");
  const capacityRaw = formData.get("capacity");

  if (
    typeof serviceId !== "string" ||
    typeof startTimeRaw !== "string" ||
    typeof endTimeRaw !== "string" ||
    typeof capacityRaw !== "string" ||
    !isValidUuid(serviceId)
  ) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const startTime = new Date(startTimeRaw);
  const endTime = new Date(endTimeRaw);
  const capacity = Number.parseInt(capacityRaw, 10);

  if (
    Number.isNaN(startTime.getTime()) ||
    Number.isNaN(endTime.getTime()) ||
    endTime <= startTime ||
    startTime <= new Date() ||
    !Number.isInteger(capacity) ||
    capacity <= 0
  ) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let provider;
  try {
    const auth = await requireApprovedProvider();
    provider = auth.provider;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    }
    throw error;
  }

  try {
    const service = await prisma.service.findFirst({ where: { id: serviceId, providerId: provider.id } });

    if (!service) {
      return { ok: false, error: "SERVICE_NOT_FOUND" };
    }

    await prisma.$transaction(async (tx) => {
      const slot = await tx.availability.create({
        data: { serviceId, startTime, endTime, capacity },
      });

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "availability.slot_created",
          entityType: "Availability",
          entityId: slot.id,
          newValue: { serviceId, startTime: startTime.toISOString(), endTime: endTime.toISOString(), capacity },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("createAvailabilitySlot.unexpected_error", {
      serviceId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
