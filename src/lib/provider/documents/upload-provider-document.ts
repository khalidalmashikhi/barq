"use server";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { isUploadableDocumentType } from "@/lib/provider-document-types";
import { isDocumentStorageConfigured, uploadPrivateObject, removePrivateObject } from "@/lib/storage/storage";
import { validateDocumentUpload } from "./document-constants";
import { buildDocumentObjectKey, sanitizeOriginalFilename } from "./document-object-key";
import { getActiveVerificationRequirements } from "./get-active-verification-requirements";
import type { UploadProviderDocumentResult, ProviderDocumentErrorCode } from "./provider-document-errors";

// Upload a NEW provider verification document (Option 1: bytes already received
// server-side by the route). Create-only: one current document per (provider,
// type) — replacing an existing one is replaceProviderDocument().
//
// ORDER (RC1 + failure isolation): validate the upload type (registry key OR an
// active configured requirement, ADR-0017), then validate size + declared MIME +
// magic bytes BEFORE any storage write; only then upload to the private bucket;
// only then create the DB row + audit atomically. If the DB write fails
// (including a unique-constraint race), the just-uploaded object is best-effort
// removed so no orphan is left.

export type UploadProviderDocumentInput = {
  type: string;
  originalFilename: string;
  declaredMimeType: string;
  bytes: ArrayBuffer;
};

export async function uploadProviderDocument(input: UploadProviderDocumentInput): Promise<UploadProviderDocumentResult> {
  let provider;
  try {
    ({ provider } = await requireProvider());
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_PROVIDER_PROFILE" };
    if (error instanceof UnauthenticatedError) throw error; // transport → login
    throw error;
  }

  // Gate 1A SERVER invariant: documents may be mutated ONLY while DRAFT. Once the
  // provider has submitted (UNDER_REVIEW), been decided (APPROVED/REJECTED), or is
  // a legacy APPLIED row, the server rejects the mutation — a direct API call can
  // never bypass the UI lock. (requireProvider() proves ownership/active status,
  // not the lifecycle stage.) A REJECTED provider must resubmit (-> DRAFT) first.
  if (provider.status !== "DRAFT") {
    return { ok: false, error: "APPLICATION_LOCKED" };
  }

  // ADR-0017: accept a registry key (compatibility + fail-safe) OR an active
  // configured requirement key; reject arbitrary strings. Never stores a key that
  // is neither, so ProviderDocument.type stays a governed stable code.
  const uploadPolicy = await getActiveVerificationRequirements();
  if (!isUploadableDocumentType(input.type, uploadPolicy)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  const head = new Uint8Array(input.bytes);
  const validation = validateDocumentUpload({
    declaredMimeType: input.declaredMimeType,
    sizeBytes: input.bytes.byteLength,
    head,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.error as ProviderDocumentErrorCode };
  }

  if (!isDocumentStorageConfigured()) {
    return { ok: false, error: "STORAGE_NOT_CONFIGURED" };
  }

  // Friendly pre-check (the unique constraint is the authoritative guard below).
  const existing = await prisma.providerDocument.findUnique({
    where: { providerId_type: { providerId: provider.id, type: input.type } },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: "ALREADY_EXISTS" };
  }

  const objectKey = buildDocumentObjectKey({
    providerId: provider.id,
    type: input.type,
    ext: validation.ext,
    unique: randomUUID(),
  });

  try {
    await uploadPrivateObject({ objectKey, body: input.bytes, contentType: validation.mimeType });
  } catch (error) {
    logger.error("uploadProviderDocument.storage_failed", {
      providerId: provider.id,
      message: error instanceof Error ? error.message : String(error),
    });
    // Gate 0: distinct from the generic UNKNOWN_ERROR so the provider sees an
    // actionable "could not upload right now" message and the failure class is
    // legible (the storage write threw — e.g. a missing/misconfigured bucket).
    return { ok: false, error: "UPLOAD_FAILED" };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const doc = await tx.providerDocument.create({
        data: {
          providerId: provider.id,
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
          action: "provider.document_uploaded",
          entityType: "ProviderDocument",
          entityId: doc.id,
          newValue: { type: input.type, status: "PENDING" },
        },
        tx
      );
      return doc;
    });
    return { ok: true, documentId: created.id };
  } catch (error) {
    // DB write failed after a successful upload — clean up the orphan object.
    await removePrivateObject(objectKey).catch(() => {});
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "ALREADY_EXISTS" }; // lost the (providerId, type) race
    }
    logger.error("uploadProviderDocument.db_failed", {
      providerId: provider.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }
}
