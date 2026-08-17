"use server";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { notifyAdminsOfProviderEvent, PROVIDER_NOTIFICATION_EVENT } from "@/lib/notifications/provider-notification-events";
import { isUploadableDocumentType, resolveVerificationChecklist } from "@/lib/provider-document-types";
import { isDocumentStorageConfigured, uploadPrivateObject, removePrivateObject } from "@/lib/storage/storage";
import { validateDocumentUpload } from "./document-constants";
import { buildDocumentObjectKey, sanitizeOriginalFilename } from "./document-object-key";
import { getActiveVerificationRequirements } from "./get-active-verification-requirements";
import { canMutateVerificationDocument } from "./verification-lifecycle";
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

  // ADR-0017: accept a registry key (compatibility + fail-safe) OR an active
  // configured requirement key; reject arbitrary strings. Never stores a key that
  // is neither, so ProviderDocument.type stays a governed stable code.
  const uploadPolicy = await getActiveVerificationRequirements();
  if (!isUploadableDocumentType(input.type, uploadPolicy)) {
    return { ok: false, error: "INVALID_INPUT" };
  }

  // Gate 1A/1B + optional-during-review SERVER invariant. Mutation is allowed
  // while DRAFT/CHANGES_REQUESTED; once submitted (UNDER_REVIEW or legacy APPLIED)
  // the ONLY permitted upload is the FIRST upload of an APPLICABLE OPTIONAL
  // requirement (required docs + non-applicable types stay locked). Required-ness
  // is derived from the RESOLVED checklist (server-side), never from the client;
  // a type not in the provider's checklist is treated as required (no exception).
  // A direct API call can never bypass this. (documentExists is enforced below by
  // the ALREADY_EXISTS pre-check + the unique constraint, so it is false here.)
  const checklistItem = resolveVerificationChecklist(uploadPolicy, { providerType: provider.providerType }).find(
    (r) => r.key === input.type
  );
  const requirementRequired = checklistItem ? checklistItem.required : true;
  if (
    !canMutateVerificationDocument({
      providerStatus: provider.status,
      requirementRequired,
      documentExists: false,
      mutationType: "upload",
    })
  ) {
    return { ok: false, error: "APPLICATION_LOCKED" };
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
    // Gate B2 — admin fan-out on a successful INITIAL upload (post-commit,
    // fire-and-forget: a notification failure must never fail the durable upload
    // and must not reach the outer catch). Static content — no filename, size, or
    // document contents in the notification body.
    try {
      await notifyAdminsOfProviderEvent(PROVIDER_NOTIFICATION_EVENT.DOCUMENT_UPLOADED, {
        providerId: provider.id,
      });
    } catch (notifyError) {
      logger.error("uploadProviderDocument.notification_failed", {
        providerId: provider.id,
        message: notifyError instanceof Error ? notifyError.message : String(notifyError),
      });
    }
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
