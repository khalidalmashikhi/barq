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
import { isRequiredDocumentRemediable } from "./document-remediation";
import { requiredAssetDocumentTypesFor } from "./asset-document-types";
import { parseClaimedExpiryDate } from "./document-expiry-claim";
import type { AssetDocumentErrorCode } from "./asset-document-errors";

// VEHICLE-LC2 / LC5 — replace one of the caller's OWN vehicle documents with a new
// immutable object, resetting it to PENDING. Two disjoint gates decide whether a
// replacement is allowed:
//   • LC2 (editable verification: DRAFT/CHANGES_REQUESTED) — a PENDING or REJECTED
//     document may be replaced; an APPROVED one stays LOCKED.
//   • LC5 (APPROVED verification) — the NARROW expired-required-document remediation
//     exception: only an expired-APPROVED or REJECTED REQUIRED document may be
//     replaced (isRequiredDocumentRemediable). This NEVER touches verificationStatus
//     or Asset.status; the replacement returns to PENDING admin review before the
//     vehicle can recover selectability. A valid (unexpired) APPROVED document and any
//     non-required document stay LOCKED — no arbitrary APPROVED-document editing.
// Every other verification state (SUBMITTED/REJECTED) is fully locked.
// RC3-safe: the swap is an atomic updateMany bound to the seen objectKey; the OLD
// object is removed only AFTER the DB swap commits.

export type ReplaceVehicleDocumentInput = {
  originalFilename: string;
  declaredMimeType: string;
  bytes: ArrayBuffer;
  /** VEHICLE-LC6 — OPTIONAL provider-claimed expiry date ("YYYY-MM-DD", advisory). */
  claimedExpiryDate?: string | null;
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
    select: { id: true, type: true, status: true, expiresAt: true, objectKey: true, assetId: true, asset: { select: { verificationStatus: true } } },
  });
  if (!doc) return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  // LC2 editable states: replace a PENDING/REJECTED doc (APPROVED stays LOCKED).
  // LC5 APPROVED state: replace ONLY a remediable required doc (expired-APPROVED or
  // REJECTED). isRequiredDocumentRemediable is evaluated ONLY in the non-editable
  // branch, so an editable vehicle never depends on expiry/required-type.
  const allowed = isAssetVerificationEditable(doc.asset.verificationStatus)
    ? doc.status === "PENDING" || doc.status === "REJECTED"
    : isRequiredDocumentRemediable({
        verificationStatus: doc.asset.verificationStatus,
        documentType: doc.type,
        requiredTypes: requiredAssetDocumentTypesFor("VEHICLE"),
        documentStatus: doc.status,
        expiresAt: doc.expiresAt,
        now: new Date(),
      });
  if (!allowed) return { ok: false, error: "LOCKED" };

  // OPTIONAL provider-claimed expiry date — advisory only (never the trusted expiresAt).
  const claim = parseClaimedExpiryDate(doc.type, input.claimedExpiryDate);
  if (!claim.ok) return { ok: false, error: "INVALID_INPUT" };

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
          // VEHICLE-LC6 stale-trust safety: a replacement carries only the NEW advisory
          // claim, and the OLD trusted expiry is CLEARED — the replacement has no
          // authoritative expiry until an admin re-confirms it at approval. (Selectability
          // already fails on the PENDING status; this keeps the data model unambiguous.)
          claimedExpiryDate: claim.value,
          expiresAt: null,
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
