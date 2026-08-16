"use server";

import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { assertReadyToSubmit, type SubmitBlocker } from "./documents/assert-ready-to-submit";

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
  // Only a DRAFT is submittable. Legacy APPLIED (already submitted), APPROVED,
  // REJECTED (resubmit -> DRAFT first), SUSPENDED/DEACTIVATED are not.
  if (provider.status !== "DRAFT") {
    return { ok: false, error: "INVALID_STATE" };
  }

  const blockers = await assertReadyToSubmit(provider.id, provider.providerType);
  if (blockers.length > 0) {
    return { ok: false, error: "NOT_READY", blockers };
  }

  const submittedAt = new Date();
  const raced = await prisma.$transaction(async (tx) => {
    const updated = await tx.provider.updateMany({
      where: { id: provider.id, status: "DRAFT" }, // optimistic concurrency guard
      data: { status: "UNDER_REVIEW", submittedAt },
    });
    if (updated.count === 0) return true; // a concurrent submit won the race
    await recordAuditEvent(
      {
        actorType: "PROVIDER",
        actorId: provider.id,
        action: "provider.verification_submitted",
        entityType: "Provider",
        entityId: provider.id,
        previousValue: { status: "DRAFT" },
        newValue: { status: "UNDER_REVIEW" },
      },
      tx
    );
    return false;
  });

  return { ok: true, status: "UNDER_REVIEW", alreadySubmitted: raced };
}
