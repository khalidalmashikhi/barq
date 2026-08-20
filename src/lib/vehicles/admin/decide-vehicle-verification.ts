"use server";

import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { getVehicleVerificationApprovalBlockers } from "./get-vehicle-verification-approval-blockers";
import { notifyProviderOfVehicleEvent, VEHICLE_NOTIFICATION_EVENT } from "@/lib/notifications/vehicle-notification-events";
import type { VehicleAdminActionResult, VehicleAdminActionErrorCode } from "./vehicle-admin-errors";

// VEHICLE-LC3 — the three authoritative admin decisions on a SUBMITTED vehicle's
// verification. Mirrors reject-provider.ts / request-provider-changes.ts:
// requireAdmin (reviewer id server-derived, never client-supplied), UUID + reason
// validation, an OPTIMISTIC conditional transition guarded on verificationStatus =
// SUBMITTED (a stale/raced decision matches 0 rows → NOT_SUBMITTED, never overwrites
// another admin's decision), and an in-transaction audit event. NO notification
// (deferred to VEHICLE-LC4).
//
// TWO-AXIS INVARIANT (CRITICAL): NONE of these actions ever writes Asset.status.
// approveVehicleVerification sets verificationStatus = APPROVED ONLY — a vehicle can
// be Asset.status = REGISTERED + verificationStatus = APPROVED and is STILL not
// customer-selectable. Operational activation is a separate, later gate.

const MAX_REASON_LENGTH = 2000;

async function resolveAdmin(): Promise<{ ok: true; adminId: string } | { ok: false; error: VehicleAdminActionErrorCode }> {
  try {
    const { admin } = await requireAdmin();
    return { ok: true, adminId: admin.id };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    if (error instanceof UnauthenticatedError) throw error;
    throw error;
  }
}

function validateReason(reasonInput: string): { ok: true; reason: string } | { ok: false; error: VehicleAdminActionErrorCode } {
  const reason = typeof reasonInput === "string" ? reasonInput.trim() : "";
  if (reason.length === 0) return { ok: false, error: "REASON_REQUIRED" };
  if (reason.length > MAX_REASON_LENGTH) return { ok: false, error: "INVALID_INPUT" };
  return { ok: true, reason };
}

// SUBMITTED → APPROVED. Allowed ONLY when the shared approval-blockers primitive is
// clear (every required doc present + APPROVED + unexpired, vehicle data present,
// state SUBMITTED). Sets the review metadata and clears verificationReason. NEVER
// sets Asset.status ACTIVE and NEVER makes the vehicle selectable.
export async function approveVehicleVerification(assetId: string): Promise<VehicleAdminActionResult> {
  if (!isValidUuid(assetId)) return { ok: false, error: "INVALID_INPUT" };
  const auth = await resolveAdmin();
  if (!auth.ok) return auth;

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, assetType: "VEHICLE" },
    select: {
      verificationStatus: true,
      vehicle: { select: { assetId: true } },
      documents: { select: { type: true, status: true, expiresAt: true } },
      // Recipient for the post-commit provider notification — server-derived only.
      provider: { select: { userId: true } },
    },
  });
  if (!asset) return { ok: false, error: "VEHICLE_NOT_FOUND" };
  if (asset.verificationStatus !== "SUBMITTED") return { ok: false, error: "NOT_SUBMITTED" };

  const blockers = getVehicleVerificationApprovalBlockers({
    verificationStatus: asset.verificationStatus,
    hasVehicleData: asset.vehicle !== null,
    documents: asset.documents,
  });
  if (blockers.length > 0) return { ok: false, error: "NOT_READY" };

  const reviewedAt = new Date();
  try {
    const done = await prisma.$transaction(async (tx) => {
      const updated = await tx.asset.updateMany({
        where: { id: assetId, verificationStatus: "SUBMITTED" },
        data: {
          verificationStatus: "APPROVED",
          verificationReviewedAt: reviewedAt,
          verificationReviewedByAdminId: auth.adminId,
          verificationReason: null,
          // Deliberately NO status change — verification approval is NOT activation.
        },
      });
      if (updated.count === 0) return false;
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: auth.adminId,
          action: "vehicle.verification_approved",
          entityType: "Vehicle",
          entityId: assetId,
          previousValue: { verificationStatus: "SUBMITTED" },
          newValue: { verificationStatus: "APPROVED" },
        },
        tx,
      );
      return true;
    });
    if (!done) return { ok: false, error: "NOT_SUBMITTED" };

    // Post-commit, fire-and-forget — only on the REAL transition. A notification
    // failure never fails or rolls back the durable decision.
    try {
      await notifyProviderOfVehicleEvent(VEHICLE_NOTIFICATION_EVENT.VERIFICATION_APPROVED, {
        providerUserId: asset.provider.userId,
        assetId,
      });
    } catch (notifyError) {
      logger.error("approveVehicleVerification.notification_failed", { assetId, message: notifyError instanceof Error ? notifyError.message : String(notifyError) });
    }
    return { ok: true };
  } catch (error) {
    logger.error("approveVehicleVerification.db_failed", { assetId, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}

// SUBMITTED → REJECTED, with a mandatory reason. Does NOT change Asset.status.
export async function rejectVehicleVerification(assetId: string, reasonInput: string): Promise<VehicleAdminActionResult> {
  if (!isValidUuid(assetId)) return { ok: false, error: "INVALID_INPUT" };
  const reasonCheck = validateReason(reasonInput);
  if (!reasonCheck.ok) return reasonCheck;
  const auth = await resolveAdmin();
  if (!auth.ok) return auth;
  return transitionSubmitted(assetId, "REJECTED", reasonCheck.reason, "vehicle.verification_rejected", auth.adminId);
}

// SUBMITTED → CHANGES_REQUESTED, with a mandatory reason. Does NOT change
// Asset.status. The provider then edits documents (isAssetVerificationEditable) and
// explicitly re-submits (submit-vehicle-verification clears this review metadata).
export async function requestVehicleChanges(assetId: string, reasonInput: string): Promise<VehicleAdminActionResult> {
  if (!isValidUuid(assetId)) return { ok: false, error: "INVALID_INPUT" };
  const reasonCheck = validateReason(reasonInput);
  if (!reasonCheck.ok) return reasonCheck;
  const auth = await resolveAdmin();
  if (!auth.ok) return auth;
  return transitionSubmitted(assetId, "CHANGES_REQUESTED", reasonCheck.reason, "vehicle.changes_requested", auth.adminId);
}

async function transitionSubmitted(
  assetId: string,
  nextStatus: "REJECTED" | "CHANGES_REQUESTED",
  reason: string,
  action: "vehicle.verification_rejected" | "vehicle.changes_requested",
  adminId: string,
): Promise<VehicleAdminActionResult> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, assetType: "VEHICLE" },
    select: { verificationStatus: true, provider: { select: { userId: true } } },
  });
  if (!asset) return { ok: false, error: "VEHICLE_NOT_FOUND" };
  if (asset.verificationStatus !== "SUBMITTED") return { ok: false, error: "NOT_SUBMITTED" };

  const reviewedAt = new Date();
  try {
    const done = await prisma.$transaction(async (tx) => {
      const updated = await tx.asset.updateMany({
        where: { id: assetId, verificationStatus: "SUBMITTED" },
        data: {
          verificationStatus: nextStatus,
          verificationReviewedAt: reviewedAt,
          verificationReviewedByAdminId: adminId,
          verificationReason: reason,
          // Deliberately NO status change.
        },
      });
      if (updated.count === 0) return false;
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: adminId,
          action,
          entityType: "Vehicle",
          entityId: assetId,
          previousValue: { verificationStatus: "SUBMITTED" },
          newValue: { verificationStatus: nextStatus, reason, byAdminId: adminId },
        },
        tx,
      );
      return true;
    });
    if (!done) return { ok: false, error: "NOT_SUBMITTED" };

    // Post-commit, fire-and-forget — only on the REAL transition.
    const event =
      nextStatus === "REJECTED"
        ? VEHICLE_NOTIFICATION_EVENT.VERIFICATION_REJECTED
        : VEHICLE_NOTIFICATION_EVENT.CHANGES_REQUESTED;
    try {
      await notifyProviderOfVehicleEvent(event, { providerUserId: asset.provider.userId, assetId });
    } catch (notifyError) {
      logger.error("transitionSubmittedVehicle.notification_failed", { assetId, action, message: notifyError instanceof Error ? notifyError.message : String(notifyError) });
    }
    return { ok: true };
  } catch (error) {
    logger.error("transitionSubmittedVehicle.db_failed", { assetId, action, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
