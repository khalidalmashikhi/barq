"use server";

import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { notifyAdminsOfProviderEvent, PROVIDER_NOTIFICATION_EVENT } from "@/lib/notifications/provider-notification-events";
import { assertReadyToSubmit, type SubmitBlocker } from "./documents/assert-ready-to-submit";
import { isVerificationEditableStatus } from "./documents/verification-lifecycle";

// Gate 1A — explicit provider verification submission. Uploading a document does
// NOT submit; ONLY this explicit action transitions DRAFT -> UNDER_REVIEW.
//
// - Ownership: the provider comes ONLY from requireProvider() (session); there is
//   no providerId input to trust.
// - Readiness: assertReadyToSubmit() must return no blockers (every REQUIRED
//   document present + not admin-REJECTED). Gate 1A presence-only; no expiry/OCR.
// - Idempotent + concurrency-safe: the transition is an OPTIMISTIC updateMany
//   guarded on `status = 'DRAFT'`. A second concurrent/duplicate submit matches 0
//   rows and returns an idempotent success (already UNDER_REVIEW) — never a double
//   transition and never a second audit event.
// - Approval boundary: this only moves DRAFT -> UNDER_REVIEW. It NEVER approves;
//   assertProviderApprovable (the admin APPROVAL gate) is untouched.

export type SubmitProviderVerificationResult =
  | { ok: true; status: "UNDER_REVIEW"; alreadySubmitted: boolean }
  | { ok: false; error: "NOT_READY"; blockers: SubmitBlocker[] }
  | { ok: false; error: "INVALID_STATE" | "NO_PROVIDER_PROFILE" };

export async function submitProviderVerification(): Promise<SubmitProviderVerificationResult> {
  let provider;
  try {
    ({ provider } = await requireProvider());
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_PROVIDER_PROFILE" };
    if (error instanceof UnauthenticatedError) throw error; // transport -> login
    throw error;
  }

  // Idempotent: already submitted -> success no-op (no re-transition, no audit).
  if (provider.status === "UNDER_REVIEW") {
    return { ok: true, status: "UNDER_REVIEW", alreadySubmitted: true };
  }
  // Submittable ONLY from an editable state: DRAFT (initial) or CHANGES_REQUESTED
  // (admin returned it for correction). Legacy APPLIED (already submitted),
  // APPROVED, REJECTED (resubmit -> DRAFT first), SUSPENDED/DEACTIVATED are not.
  if (!isVerificationEditableStatus(provider.status)) {
    return { ok: false, error: "INVALID_STATE" };
  }
  const fromStatus = provider.status;

  const blockers = await assertReadyToSubmit(provider.id, provider.providerType);
  if (blockers.length > 0) {
    return { ok: false, error: "NOT_READY", blockers };
  }

  const submittedAt = new Date();
  const raced = await prisma.$transaction(async (tx) => {
    const updated = await tx.provider.updateMany({
      // Optimistic concurrency guard — only an editable row can be submitted.
      where: { id: provider.id, status: { in: ["DRAFT", "CHANGES_REQUESTED"] } },
      // Clear any prior changes-request reason (stored in rejectionReason) as the
      // application re-enters review. Harmless when submitting a fresh DRAFT (null).
      data: { status: "UNDER_REVIEW", submittedAt, rejectionReason: null },
    });
    if (updated.count === 0) return true; // a concurrent submit won the race
    await recordAuditEvent(
      {
        actorType: "PROVIDER",
        actorId: provider.id,
        action: "provider.verification_submitted",
        entityType: "Provider",
        entityId: provider.id,
        previousValue: { status: fromStatus },
        newValue: { status: "UNDER_REVIEW" },
      },
      tx
    );
    return false;
  });

  // Gate B2 — admin fan-out on the REAL transition only (raced === false means
  // THIS call performed the DRAFT/CHANGES_REQUESTED -> UNDER_REVIEW transition; a
  // duplicate/concurrent/no-op submit fired no audit and fires no notification).
  // Post-commit, fire-and-forget: a notification failure must never fail or roll
  // back the (already durable) submission. fromStatus selects the event —
  // CHANGES_REQUESTED -> changes_resubmitted, DRAFT -> verification_submitted.
  if (!raced) {
    const eventType =
      fromStatus === "CHANGES_REQUESTED"
        ? PROVIDER_NOTIFICATION_EVENT.CHANGES_RESUBMITTED
        : PROVIDER_NOTIFICATION_EVENT.VERIFICATION_SUBMITTED;
    try {
      await notifyAdminsOfProviderEvent(eventType, { providerId: provider.id });
    } catch (notifyError) {
      logger.error("submitProviderVerification.notification_failed", {
        providerId: provider.id,
        message: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }
  }

  return { ok: true, status: "UNDER_REVIEW", alreadySubmitted: raced };
}
