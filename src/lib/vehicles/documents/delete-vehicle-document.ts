"use server";

import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isValidUuid } from "@/lib/uuid";
import { enqueuePrivateObjectCleanup, attemptPrivateObjectCleanup } from "@/lib/storage/cleanup/private-object-cleanup";
import { isAssetVerificationEditable } from "./asset-verification-lifecycle";
import type { AssetDocumentErrorCode } from "./asset-document-errors";

// VEHICLE-LC2 — delete one of the caller's OWN vehicle documents. Policy
// (gate-approved): allowed only while verification is editable
// (DRAFT/CHANGES_REQUESTED) AND the document is PENDING or REJECTED. Deleting an
// APPROVED document is DEFERRED (returns LOCKED). Deleting a required document
// legitimately re-opens a checklist gap. The DB row is deleted in a transaction
// with an audit event; the private object is removed only AFTER the commit.

export type DeleteVehicleDocumentResult = { ok: true } | { ok: false; error: AssetDocumentErrorCode };

export async function deleteVehicleDocument(vehicleId: string, documentId: string): Promise<DeleteVehicleDocumentResult> {
  if (!isValidUuid(vehicleId) || !isValidUuid(documentId)) return { ok: false, error: "INVALID_INPUT" };

  let provider;
  try {
    ({ provider } = await requireApprovedProvider());
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    if (error instanceof UnauthenticatedError) throw error;
    throw error;
  }

  // Path-binding + ownership: the document must belong to the vehicle NAMED IN THE
  // URL (assetId === vehicleId) AND to the authenticated provider — no cross-vehicle
  // action through a mismatched URL. Missing / foreign / mismatched → one uniform
  // DOCUMENT_NOT_FOUND.
  const doc = await prisma.assetDocument.findFirst({
    where: { id: documentId, assetId: vehicleId, asset: { providerId: provider.id, assetType: "VEHICLE" } },
    select: { id: true, type: true, status: true, objectKey: true, assetId: true, asset: { select: { verificationStatus: true } } },
  });
  if (!doc) return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  if (!isAssetVerificationEditable(doc.asset.verificationStatus)) return { ok: false, error: "LOCKED" };
  if (doc.status === "APPROVED") return { ok: false, error: "LOCKED" }; // APPROVED delete deferred

  let cleanupTaskId: string | null;
  try {
    cleanupTaskId = await prisma.$transaction(async (tx) => {
      // Bound to the seen object so a concurrent replace/delete can't double-act.
      const deleted = await tx.assetDocument.deleteMany({ where: { id: doc.id, objectKey: doc.objectKey } });
      if (deleted.count === 0) return null; // already gone / raced — treat as success, nothing to clean
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "vehicle.document_deleted",
          entityType: "Vehicle",
          entityId: doc.assetId,
          previousValue: { type: doc.type, status: doc.status },
        },
        tx,
      );
      // Durably record the removed object for cleanup in the SAME tx as the delete + audit.
      return enqueuePrivateObjectCleanup(tx, { objectKey: doc.objectKey, purpose: "VEHICLE_DOCUMENT_DELETED" });
    });
  } catch (error) {
    logger.error("deleteVehicleDocument.db_failed", { documentId: doc.id, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  // Committed — immediate removal attempt; a failure stays durable for the cron to retry.
  if (cleanupTaskId) {
    await attemptPrivateObjectCleanup(cleanupTaskId).catch((error) => {
      logger.warn("deleteVehicleDocument.cleanup_threw", { documentId: doc.id, message: error instanceof Error ? error.message : String(error) });
    });
  }

  return { ok: true };
}
