"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import type { AvailabilityAdminActionErrorCode } from "./availability-admin-errors";
import type { AvailabilitySlotState } from "@prisma/client";

// Activate / Deactivate Availability (admin-initiated) — Phase 2.7
// (Availability Foundation). Fills a real, previously-deferred gap: the
// AvailabilitySlotState enum (OPEN/BLOCKED/CANCELLED) already exists,
// and get-available-slots.ts already excludes BLOCKED/CANCELLED slots
// from customer search — but no action anywhere has ever written
// BLOCKED or CANCELLED to a real row. cancel-booking.ts's own comment
// explicitly names this exact gap: "a provider's own explicit BLOCKED
// or CANCELLED override (once the Provider Dashboard exists to set
// one)". This phase closes the admin half of that gap.
//
// Deliberately OPEN <-> BLOCKED only. CANCELLED is a real, defined enum
// value this phase does NOT wire up: it isn't requested by this phase's
// own ADMIN CAPABILITIES list (Create/Update/Activate/Deactivate/List/
// Detail — no "Cancel"), and treating it as reachable here without a
// decided meaning (does cancelling a slot with active bookings cancel
// those bookings too? that's a real product question, not answered by
// this Foundation phase) would be inventing scope, not filling a gap.
// Flagged explicitly in this phase's report as a remaining, real,
// intentionally-unbuilt capability.
//
// Deactivating (OPEN -> BLOCKED) is allowed regardless of bookedCount:
// unlike delete-availability-slot.ts's SLOT_HAS_BOOKINGS safeguard
// (which exists because deleting a row would orphan existing bookings'
// availabilityId), deactivating never touches bookedCount or the row's
// existence — it only hides the slot from new-booking search
// (get-available-slots.ts's own `state: "OPEN"` filter), so any
// existing booking against it remains completely unaffected. This is a
// real, considered difference from the self-service delete action, not
// an oversight.

export type TransitionAvailabilityResult = { ok: true } | { ok: false; error: AvailabilityAdminActionErrorCode };

const AUDIT_ACTION_BY_STATE: Record<"OPEN" | "BLOCKED", string> = {
  OPEN: "availability.slot_activated",
  BLOCKED: "availability.slot_deactivated",
};

async function transition(slotId: string, fromState: AvailabilitySlotState, toState: "OPEN" | "BLOCKED"): Promise<TransitionAvailabilityResult> {
  if (!isValidUuid(slotId)) {
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

    if (slot.state !== fromState) {
      return { ok: false, error: "INVALID_STATE_TRANSITION" };
    }

    await prisma.$transaction(async (tx) => {
      await tx.availability.update({ where: { id: slotId }, data: { state: toState } });

      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: AUDIT_ACTION_BY_STATE[toState],
          entityType: "Availability",
          entityId: slotId,
          previousValue: { state: slot.state },
          newValue: { state: toState },
        },
        tx
      );
    });

    return { ok: true };
  } catch (error) {
    logger.error("transitionAvailabilityState.unexpected_error", {
      slotId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

export async function activateAvailability(slotId: string): Promise<TransitionAvailabilityResult> {
  return transition(slotId, "BLOCKED", "OPEN");
}

export async function deactivateAvailability(slotId: string): Promise<TransitionAvailabilityResult> {
  return transition(slotId, "OPEN", "BLOCKED");
}
