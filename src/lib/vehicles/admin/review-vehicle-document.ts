"use server";

import { prisma } from "@/lib/db";
import { requireAdmin, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { documentVersionToken } from "@/lib/provider/documents/document-version-token";
import { notifyProviderOfVehicleEvent, VEHICLE_NOTIFICATION_EVENT } from "@/lib/notifications/vehicle-notification-events";
import { assetDocumentTypeSupportsExpiry } from "@/lib/vehicles/documents/asset-document-types";
import { omanValidThroughDateToExpiryInstant } from "@/lib/date/oman-time";
import type { VehicleAdminActionResult } from "./vehicle-admin-errors";

// VEHICLE-LC3 — admin review of ONE vehicle AssetDocument: approve or reject a
// PENDING document. Mirrors reviewProviderDocument's RC3 stale protection exactly:
// the review is bound to the EXACT object the admin loaded via expectedVersionToken
// (derived from the current objectKey) AND the atomic updateMany is bound to
// objectKey + PENDING, so a provider replace/re-review between load and submit
// yields STALE_DOCUMENT instead of silently reviewing the wrong version. Admin is
// globally authorized (requireAdmin), so ownership is not scoped — the document id
// is sufficient. NO notification here (deferred to VEHICLE-LC4). NO objectKey ever
// leaves the server; the audit payload carries only type + resulting status.

const MAX_REASON_LENGTH = 2000;

class StaleReview extends Error {}

export type VehicleReviewDecision = "APPROVE" | "REJECT";

export async function reviewVehicleDocument(input: {
  documentId: string;
  expectedVersionToken: string;
  decision: VehicleReviewDecision;
  reason?: string;
  /**
   * VEHICLE-LC6 — the admin-confirmed "valid through" Oman date ("YYYY-MM-DD") for an
   * expiring document. On APPROVE this becomes the TRUSTED AssetDocument.expiresAt
   * (converted to the next-Oman-midnight instant). Empty/absent → the document is
   * approved with NO trusted expiry (expiresAt null). Ignored on REJECT and for a
   * document type that does not support expiry.
   */
  confirmedExpiryDate?: string | null;
}): Promise<VehicleAdminActionResult> {
  let admin;
  try {
    ({ admin } = await requireAdmin());
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_ADMIN_PROFILE" };
    if (error instanceof UnauthenticatedError) throw error;
    throw error;
  }

  let reason: string | null = null;
  if (input.decision === "REJECT") {
    reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason.length === 0) return { ok: false, error: "REASON_REQUIRED" };
    if (reason.length > MAX_REASON_LENGTH) return { ok: false, error: "INVALID_INPUT" };
  }

  const doc = await prisma.assetDocument.findUnique({
    where: { id: input.documentId },
    select: {
      id: true,
      type: true,
      status: true,
      objectKey: true,
      assetId: true,
      // Recipient for the post-commit provider notification on REJECT — server-derived.
      asset: { select: { provider: { select: { userId: true } } } },
    },
  });
  if (!doc) return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  // Only a PENDING document is reviewable; anything else means the loaded version is
  // stale (already reviewed or replaced).
  if (doc.status !== "PENDING") return { ok: false, error: "STALE_DOCUMENT" };
  if (documentVersionToken(doc.objectKey) !== input.expectedVersionToken) {
    return { ok: false, error: "STALE_DOCUMENT" };
  }

  // VEHICLE-LC6 — establish the TRUSTED expiry ONLY on APPROVE, ONLY for an
  // expiry-supporting type, ONLY from the admin-confirmed date. Empty → null (no
  // trusted expiry). A malformed confirmed date fails the whole approval (no write).
  // REJECT never establishes a trusted expiry. This is the SOLE writer of a non-null
  // AssetDocument.expiresAt — a provider claim never reaches it.
  let trustedExpiresAt: Date | null = null;
  if (input.decision === "APPROVE") {
    const raw = typeof input.confirmedExpiryDate === "string" ? input.confirmedExpiryDate.trim() : "";
    if (raw.length > 0 && assetDocumentTypeSupportsExpiry(doc.type)) {
      const instant = omanValidThroughDateToExpiryInstant(raw);
      if (!instant) return { ok: false, error: "INVALID_INPUT" };
      trustedExpiresAt = instant;
    }
  }

  const reviewedAt = new Date();
  const nextStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.assetDocument.updateMany({
        where: { id: doc.id, objectKey: doc.objectKey, status: "PENDING" }, // bound to the reviewed object
        data: {
          status: nextStatus,
          reviewedAt,
          reviewedByAdminId: admin.id,
          rejectionReason: reason, // null on APPROVE (clears any prior reason)
          // LC6: APPROVE (re)establishes the trusted expiry from the confirmed date
          // (or null); REJECT never touches it.
          ...(input.decision === "APPROVE" ? { expiresAt: trustedExpiresAt } : {}),
        },
      });
      if (updated.count === 0) throw new StaleReview();
      await recordAuditEvent(
        {
          actorType: "ADMIN",
          actorId: admin.id,
          action: input.decision === "APPROVE" ? "vehicle.document_approved" : "vehicle.document_rejected",
          entityType: "Vehicle",
          entityId: doc.assetId,
          previousValue: { type: doc.type, status: "PENDING" },
          newValue:
            input.decision === "APPROVE"
              ? // A safe normalized instant only — never objectKey / filename / contents.
                { type: doc.type, status: "APPROVED", expiresAt: trustedExpiresAt ? trustedExpiresAt.toISOString() : null }
              : { type: doc.type, status: "REJECTED", reason }, // reason retained in the audit trail
        },
        tx,
      );
    });
  } catch (error) {
    if (error instanceof StaleReview) return { ok: false, error: "STALE_DOCUMENT" };
    logger.error("reviewVehicleDocument.db_failed", {
      documentId: doc.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  // Post-commit, fire-and-forget — ONLY on a rejection (approval never notifies, to
  // avoid noise). Reached only on a successful transition (a stale/raced review
  // returned above and never gets here). A notification failure never fails the review.
  if (input.decision === "REJECT") {
    try {
      await notifyProviderOfVehicleEvent(VEHICLE_NOTIFICATION_EVENT.DOCUMENT_REJECTED, {
        providerUserId: doc.asset.provider.userId,
        assetId: doc.assetId,
      });
    } catch (notifyError) {
      logger.error("reviewVehicleDocument.notification_failed", {
        documentId: doc.id,
        message: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }
  }

  return { ok: true };
}
