"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { AvailabilityAdminActionErrorCode } from "./availability-admin-errors";

// Update Availability (admin-initiated) — Phase 2.7 (Availability
// Foundation). Mirrors src/lib/provider/update-availability-slot.ts's
// business rules exactly, reused verbatim, never bypassed: capacity can
// always change but never below the slot's current bookedCount
// (CAPACITY_BELOW_BOOKED — the schema's own CHECK constraint would
// reject it at the database level regardless); startTime/endTime can
// only change while bookedCount is 0 (SLOT_HAS_BOOKINGS otherwise) — a
// slot a real customer already booked against must not have its time
// silently moved out from under them. No ownership scope on the target
// slot, since an admin may manage any service's availability.

export type UpdateAvailabilityResult = { ok: true } | { ok: false; error: AvailabilityAdminActionErrorCode };

export async function updateAvailability(slotId: string, formData: FormData): Promise<UpdateAvailabilityResult> {
  if (!isValidUuid(slotId)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const capacityRaw = formData.get("capacity");
  const startTimeRaw = formData.get("startTime");
  const endTimeRaw = formData.get("endTime");

  if (typeof capacityRaw !== "string") {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const capacity = Number.parseInt(capacityRaw, 10);
  if (!Number.isInteger(capacity) || capacity <= 0) {
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
    const slot = await prisma.availability.findUnique({ where: { id: slotId } });

    if (!slot) {
      return { ok: false, error: "SLOT_NOT_FOUND" };
    }

    if (capacity < slot.bookedCount) {
      return { ok: false, error: "CAPACITY_BELOW_BOOKED" };
    }

    // Time fields are only present in the caller's form (and only ever
    // submitted) when the slot has zero bookings — same convention as
    // the self-service edit page. If they're absent, only capacity
    // changes.
    let startTime: Date | undefined;
    let endTime: Date | undefined;
    if (typeof startTimeRaw === "string" && typeof endTimeRaw === "string" && startTimeRaw && endTimeRaw) {
      if (slot.bookedCount > 0) {
        return { ok: false, error: "SLOT_HAS_BOOKINGS" };
      }
      const parsedStart = new Date(startTimeRaw);
      const parsedEnd = new Date(endTimeRaw);
      if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime()) || parsedEnd <= parsedStart || parsedStart <= new Date()) {
        return { ok: false, error: "INVALID_INPUT" };
      }
      startTime = parsedStart;
      endTime = parsedEnd;
    }

    await prisma.$transaction(async (tx) => {
      await tx.availability.update({
        where: { id: slotId },
        data: { capacity, ...(startTime && endTime ? { startTime, endTime } : {}) },
      });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: "availability.slot_updated",
          entityType: "Availability",
          entityId: slotId,
          previousValue: {
            capacity: slot.capacity,
            startTime: slot.startTime.toISOString(),
            endTime: slot.endTime.toISOString(),
          },
          newValue: {
            capacity,
            ...(startTime && endTime ? { startTime: startTime.toISOString(), endTime: endTime.toISOString() } : {}),
          },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("updateAvailability.unexpected_error", {
      slotId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
