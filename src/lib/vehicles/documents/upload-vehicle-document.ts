"use server";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isValidUuid } from "@/lib/uuid";
import { isDocumentStorageConfigured, uploadPrivateObject } from "@/lib/storage/storage";
import { registerUploadIntent, releaseUploadIntent, attemptPrivateObjectCleanup } from "@/lib/storage/cleanup/private-object-cleanup";
import { prepareDocumentForStorage } from "./prepare-document";
import { safeErrorCategory } from "./safe-error-category";
import { isValidAssetDocumentTypeKey } from "./asset-document-types";
import { buildAssetDocumentObjectKey, sanitizeOriginalFilename } from "./asset-document-object-key";
import { isAssetVerificationEditable } from "./asset-verification-lifecycle";
import { parseClaimedExpiryDate } from "./document-expiry-claim";
import type { AssetDocumentErrorCode } from "./asset-document-errors";

// VEHICLE-LC2 — upload a NEW private verification document for one of the caller's
// OWN vehicles. Mirrors uploadProviderDocument's failure-isolated order (validate
// type → magic-byte/size/MIME → private-bucket write → tx create + audit → orphan
// cleanup on DB failure), but keyed to the Asset (per-vehicle, @@unique([assetId,
// type])) and gated by requireApprovedProvider + asset ownership + editable
// verification state. Create-only: an existing type is replaced via
// replaceVehicleDocument. No notification here (deferred to VEHICLE-LC4).

export type UploadVehicleDocumentInput = {
  type: string;
  originalFilename: string;
  declaredMimeType: string;
  bytes: ArrayBuffer;
  /** VEHICLE-LC6 — OPTIONAL provider-claimed expiry date ("YYYY-MM-DD", advisory). */
  claimedExpiryDate?: string | null;
};

export type UploadVehicleDocumentResult = { ok: true; documentId: string } | { ok: false; error: AssetDocumentErrorCode };

export async function uploadVehicleDocument(assetId: string, input: UploadVehicleDocumentInput): Promise<UploadVehicleDocumentResult> {
  if (!isValidUuid(assetId)) return { ok: false, error: "INVALID_INPUT" };
  // Governed type only — a client can never invent an arbitrary document type.
  if (!isValidAssetDocumentTypeKey(input.type)) return { ok: false, error: "INVALID_INPUT" };
  // OPTIONAL provider-claimed expiry date — advisory only (never the trusted expiresAt).
  const claim = parseClaimedExpiryDate(input.type, input.claimedExpiryDate);
  if (!claim.ok) return { ok: false, error: "INVALID_INPUT" };

  let provider;
  try {
    ({ provider } = await requireApprovedProvider());
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, error: error.code === "PROVIDER_NOT_APPROVED" ? "PROVIDER_NOT_APPROVED" : "NO_PROVIDER_PROFILE" };
    }
    if (error instanceof UnauthenticatedError) throw error; // transport → login
    throw error;
  }

  // Ownership: scope by providerId + VEHICLE. Foreign/missing → uniform not-found.
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, providerId: provider.id, assetType: "VEHICLE" },
    select: { id: true, verificationStatus: true },
  });
  if (!asset) return { ok: false, error: "VEHICLE_NOT_FOUND" };
  if (!isAssetVerificationEditable(asset.verificationStatus)) return { ok: false, error: "LOCKED" };

  // One server-side authority for what may be stored: signature + size + (for images) decode
  // limits, orientation, re-encode with all metadata removed; a registration PDF is also checked
  // for encryption/corruption/page count. See prepare-document.ts.
  const prepared = await prepareDocumentForStorage({
    declaredMimeType: input.declaredMimeType,
    bytes: input.bytes,
    pdfPolicy: input.type === "VEHICLE_REGISTRATION" ? "REGISTRATION" : "NONE",
  });
  if (!prepared.ok) return { ok: false, error: prepared.error };

  if (!isDocumentStorageConfigured()) return { ok: false, error: "STORAGE_NOT_CONFIGURED" };

  // Friendly pre-check (the @@unique([assetId,type]) index is the real guard).
  const existing = await prisma.assetDocument.findUnique({
    where: { assetId_type: { assetId, type: input.type } },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "ALREADY_EXISTS" };

  const objectKey = buildAssetDocumentObjectKey({ assetId, type: input.type, ext: prepared.ext, unique: randomUUID() });

  // INTENT-FIRST: durably record the server-generated key BEFORE writing the object, so a crash or a
  // failed/unavailable database after the upload can never strand the private file — the cleanup
  // worker removes it once the grace elapses. Fail closed (nothing uploaded) if it can't be recorded.
  let intentTaskId: string;
  try {
    intentTaskId = await registerUploadIntent(objectKey);
  } catch (error) {
    logger.error("uploadVehicleDocument.intent_failed", { providerId: provider.id, error: safeErrorCategory(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  try {
    await uploadPrivateObject({ objectKey, body: prepared.bytes, contentType: prepared.mimeType });
  } catch (error) {
    // The object may be absent or partially written — resolve the intent now (absent == cleaned).
    await attemptPrivateObjectCleanup(intentTaskId).catch(() => {});
    logger.error("uploadVehicleDocument.storage_failed", { providerId: provider.id, error: safeErrorCategory(error) });
    return { ok: false, error: "UPLOAD_FAILED" };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      // The object becomes legitimately referenced in THIS transaction → release its intent here, so
      // "row persisted" and "no longer scheduled for deletion" commit or roll back together.
      if (!(await releaseUploadIntent(tx, objectKey))) throw new Error("upload intent no longer releasable");
      const doc = await tx.assetDocument.create({
        data: {
          assetId,
          type: input.type,
          objectKey,
          originalFilename: sanitizeOriginalFilename(input.originalFilename),
          mimeType: prepared.mimeType,
          sizeBytes: prepared.bytes.byteLength,
          status: "PENDING",
          // Advisory provider claim only; expiresAt (trusted) stays null until an admin confirms it.
          claimedExpiryDate: claim.value,
        },
      });
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "vehicle.document_uploaded",
          entityType: "Vehicle",
          entityId: assetId,
          // Never the objectKey/filename/contents — only the type + status.
          newValue: { type: input.type, status: "PENDING" },
        },
        tx,
      );
      return doc;
    });
    return { ok: true, documentId: created.id };
  } catch (error) {
    // DB write failed (or lost the (assetId,type) race) after a successful upload — the transaction
    // rolled back, so the upload intent is STILL durably recorded. Attempt the deletion now; if that
    // fails too (or the database is down), the worker retries it to completion.
    await attemptPrivateObjectCleanup(intentTaskId).catch(() => {});
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "ALREADY_EXISTS" }; // lost the (assetId, type) race
    }
    logger.error("uploadVehicleDocument.db_failed", { providerId: provider.id, error: safeErrorCategory(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
