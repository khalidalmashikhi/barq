"use server";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isValidUuid } from "@/lib/uuid";
import { isDocumentStorageConfigured, uploadPrivateObject, removePrivateObject } from "@/lib/storage/storage";
import { validateDocumentUpload } from "@/lib/provider/documents/document-constants";
import { isValidAssetDocumentTypeKey } from "./asset-document-types";
import { buildAssetDocumentObjectKey, sanitizeOriginalFilename } from "./asset-document-object-key";
import { isAssetVerificationEditable } from "./asset-verification-lifecycle";
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
};

export type UploadVehicleDocumentResult = { ok: true; documentId: string } | { ok: false; error: AssetDocumentErrorCode };

export async function uploadVehicleDocument(assetId: string, input: UploadVehicleDocumentInput): Promise<UploadVehicleDocumentResult> {
  if (!isValidUuid(assetId)) return { ok: false, error: "INVALID_INPUT" };
  // Governed type only — a client can never invent an arbitrary document type.
  if (!isValidAssetDocumentTypeKey(input.type)) return { ok: false, error: "INVALID_INPUT" };

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

  const validation = validateDocumentUpload({
    declaredMimeType: input.declaredMimeType,
    sizeBytes: input.bytes.byteLength,
    head: new Uint8Array(input.bytes),
  });
  if (!validation.ok) return { ok: false, error: validation.error as AssetDocumentErrorCode };

  if (!isDocumentStorageConfigured()) return { ok: false, error: "STORAGE_NOT_CONFIGURED" };

  // Friendly pre-check (the @@unique([assetId,type]) index is the real guard).
  const existing = await prisma.assetDocument.findUnique({
    where: { assetId_type: { assetId, type: input.type } },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "ALREADY_EXISTS" };

  const objectKey = buildAssetDocumentObjectKey({ assetId, type: input.type, ext: validation.ext, unique: randomUUID() });

  try {
    await uploadPrivateObject({ objectKey, body: input.bytes, contentType: validation.mimeType });
  } catch (error) {
    logger.error("uploadVehicleDocument.storage_failed", { providerId: provider.id, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UPLOAD_FAILED" };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const doc = await tx.assetDocument.create({
        data: {
          assetId,
          type: input.type,
          objectKey,
          originalFilename: sanitizeOriginalFilename(input.originalFilename),
          mimeType: validation.mimeType,
          sizeBytes: input.bytes.byteLength,
          status: "PENDING",
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
    // DB write failed after a successful upload — clean up the orphan object.
    await removePrivateObject(objectKey).catch(() => {});
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "ALREADY_EXISTS" }; // lost the (assetId, type) race
    }
    logger.error("uploadVehicleDocument.db_failed", { providerId: provider.id, message: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
