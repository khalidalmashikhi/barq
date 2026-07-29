"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { AvailabilityActionErrorCode } from "./availability-action-errors";

// Delete Availability Slot — Phase 4.2 (Provider Experience),
// Priority 2. Only allowed when bookedCount is 0 — this is the one
// real safeguard the Phase 4.2 audit flagged as missing ("no
// safeguard designed for what happens to existing bookings if a
// provider cancels a slot"). bookedCount is already reliably
// decremented back to 0 whenever a booking against a slot is
// cancelled/rejected (see cancel-booking.ts/reject-booking.ts's own
// atomic capacity release), so this check is exactly "does any
// currently-active booking hold a seat here" — never a slot a real
// customer is still relying on.

export type DeleteAvailabilitySlotResult = { ok: true } | { ok: false; error: AvailabilityActionErrorCode };

export async function deleteAvailabilitySlot(slotId: string): Promise<DeleteAvailabilitySlotResult> {
  if (!isValidUuid(slotId)) {
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

    if (slot.bookedCount > 0) {
      return { ok: false, error: "SLOT_HAS_BOOKINGS" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.availability.delete({ where: { id: slotId } });

      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "availability.slot_deleted",
          entityType: "Availability",
          entityId: slotId,
          previousValue: {
            serviceId: slot.serviceId,
            capacity: slot.capacity,
            startTime: slot.startTime.toISOString(),
            endTime: slot.endTime.toISOString(),
          },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("deleteAvailabilitySlot.unexpected_error", {
      slotId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
