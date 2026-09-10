"use server";

import { prisma } from "@/lib/db";
import { requirePermission, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { notifyProviderOfEvent, PROVIDER_NOTIFICATION_EVENT } from "@/lib/notifications/provider-notification-events";
import { documentVersionToken } from "./document-version-token";
import type { ProviderDocumentActionResult } from "./provider-document-errors";

// Admin review of a provider document — approve or reject a PENDING document.
// RC3 stale protection: the review is bound to the EXACT object the admin
// reviewed via `expectedVersionToken` — if the provider replaced the document
// after the admin loaded it, the token (derived from the now-current objectKey)
// no longer matches → STALE_DOCUMENT, and the admin must reload and re-review
// the new object. The atomic conditional update (bound to objectKey + PENDING)
// closes the check→write race. Reject requires a mandatory trimmed reason. The
// review decision + reason are written with an audit event in one transaction.
//
// Gate 3: on a successful REJECT this fires a static PROVIDER_DOCUMENT_REJECTED
// notification (post-commit, fire-and-forget). It never embeds the admin's
// free-text reason and never rejects the whole provider. The approval-completeness
// gate lives in approveProvider() (via assertProviderApprovable), not here.

const MAX_REASON_LENGTH = 2000;

class StaleReview extends Error {}

export type ReviewDecision = "APPROVE" | "REJECT";

export async function reviewProviderDocument(input: {
  documentId: string;
  expectedVersionToken: string;
  decision: ReviewDecision;
  reason?: string;
  // Phase 3B Phase 1 (compliance) — the admin-confirmed expiry instant of this evidence, recorded on
  // APPROVE (mirrors VEHICLE-LC6's admin-confirm-at-approval). Optional and additive: a document type
  // whose requirement declares `evidenceExpires` needs a future value for its vertical to be
  // approvable; non-expiring evidence leaves it null. Ignored on REJECT. Date-only inputs are
  // converted to an instant by the caller (end-of-day Asia/Muscat).
  expiresAt?: Date | null;
}): Promise<ProviderDocumentActionResult> {
  let actor;
  try {
    ({ actor } = await requirePermission("providers.review"));
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

  // Compliance expiry (APPROVE only): a supplied value must be a valid instant. It is stored as-is
  // (the vertical-approval gate enforces that an expiring requirement's expiry is in the FUTURE), and
  // cleared to null when absent. On REJECT the expiry is never written.
  let expiresAt: Date | null = null;
  if (input.decision === "APPROVE" && input.expiresAt != null) {
    if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime())) {
      return { ok: false, error: "INVALID_INPUT" };
    }
    expiresAt = input.expiresAt;
  }

  const doc = await prisma.providerDocument.findUnique({
    where: { id: input.documentId },
    include: { provider: { select: { userId: true } } },
  });
  if (!doc) return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  // Only a PENDING document is reviewable; anything else means the version the
  // admin loaded is stale (already reviewed or replaced).
  if (doc.status !== "PENDING") return { ok: false, error: "STALE_DOCUMENT" };
  if (documentVersionToken(doc.objectKey) !== input.expectedVersionToken) {
    return { ok: false, error: "STALE_DOCUMENT" };
  }

  const reviewedAt = new Date();
  const nextStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.providerDocument.updateMany({
        where: { id: doc.id, objectKey: doc.objectKey, status: "PENDING" }, // bound to the reviewed object
        data: {
          status: nextStatus,
          reviewedAt,
          reviewedByAdminId: actor.admin?.id ?? null,
          rejectionReason: reason, // null on APPROVE (clears any prior reason)
          // APPROVE records the confirmed expiry (null clears it); REJECT clears it (unusable evidence).
          expiresAt: input.decision === "APPROVE" ? expiresAt : null,
        },
      });
      if (updated.count === 0) throw new StaleReview();
      await recordAuditEvent(
        {
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: input.decision === "APPROVE" ? "provider.document_approved" : "provider.document_rejected",
          entityType: "ProviderDocument",
          entityId: doc.id,
          previousValue: { status: "PENDING" },
          newValue:
            input.decision === "APPROVE"
              ? { status: "APPROVED" }
              : { status: "REJECTED", reason }, // reason retained in the audit trail
        },
        tx
      );
    });
  } catch (error) {
    if (error instanceof StaleReview) return { ok: false, error: "STALE_DOCUMENT" };
    logger.error("reviewProviderDocument.db_failed", {
      documentId: doc.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  // Document-level rejection notification (Gate 3) — post-commit, fire-and-forget.
  // A notification failure must NEVER roll back the (already durable) review, and
  // must not surface as an error. Static content only; the free-text reason lives
  // on /provider/verification, never in the notification body.
  if (input.decision === "REJECT") {
    try {
      await notifyProviderOfEvent(PROVIDER_NOTIFICATION_EVENT.DOCUMENT_REJECTED, {
        providerUserId: doc.provider.userId,
        providerId: doc.providerId,
      });
    } catch (notifyError) {
      logger.error("reviewProviderDocument.notification_failed", {
        documentId: doc.id,
        message: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }
  }

  return { ok: true };
}
