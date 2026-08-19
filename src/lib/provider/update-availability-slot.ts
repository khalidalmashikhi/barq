"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { omanLocalToUtc } from "@/lib/date/oman-time";
import type { AvailabilityActionErrorCode } from "./availability-action-errors";

// Edit Availability Slot — Phase 4.2 (Provider Experience),
// Priority 2. Capacity can always be changed, but never below the
// slot's current bookedCount (the schema's own CHECK constraint would
// reject that at the database level regardless; this is the same rule
// enforced earlier, with an honest error code instead of a raw SQL
// failure surfacing to the provider).
//
// startTime/endTime can only be changed while bookedCount is 0 — a
// slot a real customer has already booked against must not have its
// time silently moved out from under them; the UI only renders the
// time fields at all when this is true (see the edit page's own note).

export type UpdateAvailabilitySlotResult = { ok: true } | { ok: false; error: AvailabilityActionErrorCode };

export async function updateAvailabilitySlot(slotId: string, formData: FormData): Promise<UpdateAvailabilitySlotResult> {
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
    const slot = await prisma.availability.findFirst({
      where: { id: slotId, service: { providerId: provider.id } },
    });

    if (!slot) {
      return { ok: false, error: "SLOT_NOT_FOUND" };
    }

    if (capacity < slot.bookedCount) {
      return { ok: false, error: "CAPACITY_BELOW_BOOKED" };
    }

    // Time fields are only present in the form (and only ever
    // submitted) when the slot has zero bookings — see module note
    // above. If they're absent, only capacity changes.
    let startTime: Date | undefined;
    let endTime: Date | undefined;
    if (typeof startTimeRaw === "string" && typeof endTimeRaw === "string" && startTimeRaw && endTimeRaw) {
      if (slot.bookedCount > 0) {
        return { ok: false, error: "SLOT_HAS_BOOKINGS" };
      }
      // Naive Oman wall-clock from datetime-local → Asia/Muscat instant.
      const parsedStart = omanLocalToUtc(startTimeRaw);
      const parsedEnd = omanLocalToUtc(endTimeRaw);
      if (!parsedStart || !parsedEnd || parsedEnd <= parsedStart || parsedStart <= new Date()) {
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
          actorType: "PROVIDER",
          actorId: provider.id,
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
    logger.error("updateAvailabilitySlot.unexpected_error", {
      slotId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
