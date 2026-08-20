"use server";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isValidUuid } from "@/lib/uuid";
import { isDocumentStorageConfigured, uploadPrivateObject, removePrivateObject } from "@/lib/storage/storage";
import { validateDocumentUpload } from "@/lib/provider/documents/document-constants";
import { buildAssetDocumentObjectKey, sanitizeOriginalFilename } from "./asset-document-object-key";
import { isAssetVerificationEditable } from "./asset-verification-lifecycle";
import type { AssetDocumentErrorCode } from "./asset-document-errors";

// VEHICLE-LC2 — replace one of the caller's OWN vehicle documents with a new
// immutable object, resetting it to PENDING. Policy (gate-approved): allowed only
// while verification is editable (DRAFT/CHANGES_REQUESTED) AND the document is
// PENDING or REJECTED. Replacing an APPROVED document is DEFERRED (returns LOCKED)
// — that is a review-invalidation policy for a later gate. RC3-safe: the swap is
// an atomic updateMany bound to the seen objectKey; the OLD object is removed only
// AFTER the DB swap commits.

export type ReplaceVehicleDocumentInput = {
  originalFilename: string;
  declaredMimeType: string;
  bytes: ArrayBuffer;
};

export type ReplaceVehicleDocumentResult = { ok: true } | { ok: false; error: AssetDocumentErrorCode };

class StaleReplacement extends Error {}

export async function replaceVehicleDocument(vehicleId: string, documentId: string, input: ReplaceVehicleDocumentInput): Promise<ReplaceVehicleDocumentResult> {
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
  // URL (assetId === vehicleId) AND to the authenticated provider. A provider can
  // never act on their OWN vehicle B's document through vehicle A's URL. Missing /
  // foreign / mismatched all collapse to one uniform DOCUMENT_NOT_FOUND.
  const doc = await prisma.assetDocument.findFirst({
    where: { id: documentId, assetId: vehicleId, asset: { providerId: provider.id, assetType: "VEHICLE" } },
    select: { id: true, type: true, status: true, objectKey: true, assetId: true, asset: { select: { verificationStatus: true } } },
  });
  if (!doc) return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  if (!isAssetVerificationEditable(doc.asset.verificationStatus)) return { ok: false, error: "LOCKED" };
  if (doc.status === "APPROVED") return { ok: false, error: "LOCKED" }; // APPROVED replace deferred

  const validation = validateDocumentUpload({ declaredMimeType: input.declaredMimeType, sizeBytes: input.bytes.byteLength, head: new Uint8Array(input.bytes) });
  if (!validation.ok) return { ok: false, error: validation.error as AssetDocumentErrorCode };
  if (!isDocumentStorageConfigured()) return { ok: false, error: "STORAGE_NOT_CONFIGURED" };

  const newKey = buildAssetDocumentObjectKey({ assetId: doc.assetId, type: doc.type, ext: validation.ext, unique: randomUUID() });

  try {
    await uploadPrivateObject({ objectKey: newKey, body: input.bytes, contentType: validation.mimeType });
  } catch (error) {
    logger.error("replaceVehicleDocument.storage_failed", { documentId: doc.id, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UPLOAD_FAILED" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.assetDocument.updateMany({
        where: { id: doc.id, objectKey: doc.objectKey }, // bound to the seen object (RC3)
        data: {
          objectKey: newKey,
          status: "PENDING",
          rejectionReason: null,
          reviewedAt: null,
          reviewedByAdminId: null,
          originalFilename: sanitizeOriginalFilename(input.originalFilename),
          mimeType: validation.mimeType,
          sizeBytes: input.bytes.byteLength,
        },
      });
      if (updated.count === 0) throw new StaleReplacement();
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "vehicle.document_replaced",
          entityType: "Vehicle",
          entityId: doc.assetId,
          previousValue: { type: doc.type, status: doc.status },
          newValue: { type: doc.type, status: "PENDING" },
        },
        tx,
      );
    });
  } catch (error) {
    await removePrivateObject(newKey).catch(() => {}); // no orphan on stale/failure
    if (error instanceof StaleReplacement) return { ok: false, error: "DOCUMENT_NOT_FOUND" };
    logger.error("replaceVehicleDocument.db_failed", { documentId: doc.id, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  // Committed — best-effort remove the OLD object (its failure never undoes the swap).
  await removePrivateObject(doc.objectKey).catch((error) => {
    logger.error("replaceVehicleDocument.old_cleanup_failed", { documentId: doc.id, message: error instanceof Error ? error.message : String(error) });
  });

  return { ok: true };
}
