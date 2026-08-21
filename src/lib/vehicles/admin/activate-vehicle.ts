"use server";

import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getVehicleActivationBlockers, ACTIVATABLE_SOURCE_STATUS } from "./get-vehicle-activation-blockers";
import { notifyProviderOfVehicleEvent, VEHICLE_NOTIFICATION_EVENT } from "@/lib/notifications/vehicle-notification-events";
import type { VehicleAdminActionResult } from "./vehicle-admin-errors";

// VEHICLE-LC7 — the ONE authoritative admin operational-activation action:
// REGISTERED + verificationStatus APPROVED + activation blockers clear → Asset.status
// ACTIVE. Mirrors decide-vehicle-verification.ts exactly: requireAdmin (admin id
// server-derived, never client-supplied), server-side blocker evaluation (never trust
// a disabled button), an OPTIMISTIC conditional transition guarded on the EXACT source
// state, an in-transaction audit event, and a post-commit fire-and-forget provider
// notification.
//
// TWO-AXIS INVARIANT (mirror of LC3, opposite axis): this action writes ONLY
// Asset.status. It NEVER touches verificationStatus, document statuses, expiresAt,
// claimedExpiryDate, ProviderCategory, Service, or Booking. Verification approval and
// operational activation stay independent admin decisions — approving verification
// never auto-activates, and activation never re-approves anything. Selectability is
// still derived separately (an ACTIVE vehicle can later become non-selectable if a
// required document expires, WITHOUT any status mutation here or elsewhere).

export async function activateVehicle(assetId: string): Promise<VehicleAdminActionResult> {
  if (!isValidUuid(assetId)) return { ok: false, error: "INVALID_INPUT" };

  let adminId: string;
  try {
    const { admin } = await requireAdmin();
    adminId = admin.id;
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    if (error instanceof UnauthenticatedError) throw error;
    throw error;
  }

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, assetType: "VEHICLE" },
    select: {
      status: true,
      verificationStatus: true,
      vehicle: { select: { assetId: true } },
      documents: { select: { type: true, status: true, expiresAt: true } },
      // Recipient for the post-commit provider notification — server-derived only.
      provider: { select: { userId: true } },
    },
  });
  if (!asset) return { ok: false, error: "VEHICLE_NOT_FOUND" };
  // A clearer message than a generic blocker for the common re-click / already-done case.
  if (asset.status === "ACTIVE") return { ok: false, error: "ALREADY_ACTIVE" };

  const blockers = getVehicleActivationBlockers({
    operationalStatus: asset.status,
    verificationStatus: asset.verificationStatus,
    hasVehicleData: asset.vehicle !== null,
    documents: asset.documents,
  });
  if (blockers.length > 0) return { ok: false, error: "NOT_READY" };

  try {
    const done = await prisma.$transaction(async (tx) => {
      // Guarded on the EXACT source state — a concurrent activation/verification change
      // matches 0 rows and never overwrites another writer's decision.
      const updated = await tx.asset.updateMany({
        where: { id: assetId, status: ACTIVATABLE_SOURCE_STATUS, verificationStatus: "APPROVED" },
        data: {
          status: "ACTIVE",
          // Deliberately NOTHING else — verification/documents/expiry are untouched.
        },
      });
      if (updated.count === 0) return false;
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: adminId,
          action: "vehicle.activated",
          entityType: "Vehicle",
          entityId: assetId,
          previousValue: { status: ACTIVATABLE_SOURCE_STATUS },
          newValue: { status: "ACTIVE" },
        },
        tx,
      );
      return true;
    });
    if (!done) return { ok: false, error: "ACTIVATION_CONFLICT" };

    // Post-commit, fire-and-forget — only on the REAL transition (a lost race returned
    // above and never reaches here, so there is no double notification). A notification
    // failure never fails or rolls back the durable activation.
    try {
      await notifyProviderOfVehicleEvent(VEHICLE_NOTIFICATION_EVENT.ACTIVATED, {
        providerUserId: asset.provider.userId,
        assetId,
      });
    } catch (notifyError) {
      logger.error("activateVehicle.notification_failed", { assetId, message: notifyError instanceof Error ? notifyError.message : String(notifyError) });
    }
    return { ok: true };
  } catch (error) {
    logger.error("activateVehicle.db_failed", { assetId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
