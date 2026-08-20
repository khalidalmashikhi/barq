"use server";

import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { logger } from "@/lib/logger";
import { isValidUuid } from "@/lib/uuid";
import { requiredAssetDocumentTypesFor } from "./asset-document-types";
import { getVehicleVerificationSubmissionBlockers, type VehicleSubmissionBlocker } from "./asset-verification-submission";
import { isAssetVerificationEditable } from "./asset-verification-lifecycle";

// VEHICLE-LC2 — explicit provider submission of a vehicle for BARQ verification.
// Uploading documents does NOT submit; ONLY this action transitions
// DRAFT/CHANGES_REQUESTED → SUBMITTED. Mirrors submitProviderVerification:
//   - Ownership from requireApprovedProvider() + assetId scope (no providerId in).
//   - Idempotent + concurrency-safe: optimistic updateMany guarded on the editable
//     states; a raced/duplicate submit matches 0 rows → idempotent success, no
//     double transition, no second audit.
//   - Readiness: getVehicleVerificationSubmissionBlockers() must be empty (every
//     required doc present + not REJECTED; PENDING/APPROVED satisfy submission).
//   - NEVER approves and NEVER activates: it only sets SUBMITTED. It does not touch
//     Asset.status and never writes verificationStatus APPROVED.
// No notification here (deferred to VEHICLE-LC4).

export type SubmitVehicleVerificationResult =
  | { ok: true; status: "SUBMITTED"; alreadySubmitted: boolean }
  | { ok: false; error: "NOT_READY"; blockers: VehicleSubmissionBlocker[] }
  | { ok: false; error: "INVALID_STATE" | "VEHICLE_NOT_FOUND" | "NO_PROVIDER_PROFILE" | "PROVIDER_NOT_APPROVED" | "UNKNOWN_ERROR" };

export async function submitVehicleVerification(assetId: string): Promise<SubmitVehicleVerificationResult> {
  if (!isValidUuid(assetId)) return { ok: false, error: "VEHICLE_NOT_FOUND" };

  let provider;
  try {
    ({ provider } = await requireApprovedProvider());
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    if (error instanceof UnauthenticatedError) throw error;
    throw error;
  }

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, providerId: provider.id, assetType: "VEHICLE" },
    select: { id: true, verificationStatus: true, documents: { select: { type: true, status: true } } },
  });
  if (!asset) return { ok: false, error: "VEHICLE_NOT_FOUND" };

  // Idempotent: already submitted → success no-op (no re-transition, no audit).
  if (asset.verificationStatus === "SUBMITTED") {
    return { ok: true, status: "SUBMITTED", alreadySubmitted: true };
  }
  // Submittable ONLY from an editable state (DRAFT / CHANGES_REQUESTED).
  if (!isAssetVerificationEditable(asset.verificationStatus)) {
    return { ok: false, error: "INVALID_STATE" };
  }
  const fromStatus = asset.verificationStatus;

  const blockers = getVehicleVerificationSubmissionBlockers(requiredAssetDocumentTypesFor("VEHICLE"), asset.documents);
  if (blockers.length > 0) {
    return { ok: false, error: "NOT_READY", blockers };
  }

  const submittedAt = new Date();
  try {
    const raced = await prisma.$transaction(async (tx) => {
      const updated = await tx.asset.updateMany({
        where: { id: assetId, verificationStatus: { in: ["DRAFT", "CHANGES_REQUESTED"] } },
        data: {
          verificationStatus: "SUBMITTED",
          verificationSubmittedAt: submittedAt,
          // Re-entering review — clear any prior admin-review metadata + reason.
          verificationReviewedAt: null,
          verificationReviewedByAdminId: null,
          verificationReason: null,
        },
      });
      if (updated.count === 0) return true; // a concurrent submit won the race
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "vehicle.verification_submitted",
          entityType: "Vehicle",
          entityId: assetId,
          previousValue: { verificationStatus: fromStatus },
          newValue: { verificationStatus: "SUBMITTED" },
        },
        tx,
      );
      return false;
    });
    return { ok: true, status: "SUBMITTED", alreadySubmitted: raced };
  } catch (error) {
    logger.error("submitVehicleVerification.db_failed", { providerId: provider.id, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
