"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { omanLocalToUtc } from "@/lib/date/oman-time";
import type { AvailabilityAdminActionErrorCode } from "./availability-admin-errors";

// Create Availability (admin-initiated) — Phase 2.7 (Availability
// Foundation). Mirrors src/lib/provider/create-availability-slot.ts's
// validation exactly (same time-range/future-start/capacity rules —
// reused verbatim, never redesigned), with two differences: requireAdmin()
// instead of requireApprovedProvider(), and no provider-ownership scope
// on the target service, since an admin may create a slot for any
// service. A new slot always starts OPEN with bookedCount 0 (schema
// defaults) — this action never accepts either as input, same as the
// self-service one.

export type CreateAvailabilityResult = { ok: true; slotId: string } | { ok: false; error: AvailabilityAdminActionErrorCode };

export async function createAvailability(formData: FormData): Promise<CreateAvailabilityResult> {
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

  // Naive Oman wall-clock from datetime-local → Asia/Muscat instant (not the
  // server's runtime timezone). Mirrors the provider action verbatim.
  const startTime = omanLocalToUtc(startTimeRaw);
  const endTime = omanLocalToUtc(endTimeRaw);
  const capacity = Number.parseInt(capacityRaw, 10);

  if (
    !startTime ||
    !endTime ||
    endTime <= startTime ||
    startTime <= new Date() ||
    !Number.isInteger(capacity) ||
    capacity <= 0
  ) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  let admin;
  try {
    const auth = await requireAdmin();
    admin = auth.admin;
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect("/");
    }
    if (error instanceof ForbiddenError) {
      return { ok: false, error: "NO_ADMIN_PROFILE" };
    }
    throw error;
  }

  try {
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) {
      return { ok: false, error: "SERVICE_NOT_FOUND" };
    }

    const slotId = await prisma.$transaction(async (tx) => {
      const slot = await tx.availability.create({
        data: { serviceId, startTime, endTime, capacity },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "availability.slot_created",
          entityType: "Availability",
          entityId: slot.id,
          newValue: { serviceId, startTime: startTime.toISOString(), endTime: endTime.toISOString(), capacity },
        },
        tx
      );

      return slot.id;
    });

    return { ok: true, slotId };
  } catch (error) {
    logger.error("createAvailability.unexpected_error", {
      adminId: admin.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
