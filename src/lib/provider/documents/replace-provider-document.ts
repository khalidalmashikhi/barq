"use server";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { notifyAdminsOfProviderEvent, PROVIDER_NOTIFICATION_EVENT } from "@/lib/notifications/provider-notification-events";
import { isDocumentStorageConfigured, uploadPrivateObject, removePrivateObject } from "@/lib/storage/storage";
import { validateDocumentUpload } from "./document-constants";
import { buildDocumentObjectKey, sanitizeOriginalFilename } from "./document-object-key";
import { documentVersionToken } from "./document-version-token";
import { isVerificationEditableStatus } from "./verification-lifecycle";
import type { ProviderDocumentActionResult, ProviderDocumentErrorCode } from "./provider-document-errors";

// Replace an existing provider document with a NEW immutable object, resetting
// it to PENDING. Allowed for PENDING/REJECTED/APPROVED (an APPROVED document may
// be replaced — it returns to PENDING for re-review; it may not be deleted).
//
// RC3 concurrency: bound to the exact reviewed/seen object via `expectedVersionToken`
// AND an atomic conditional update on the old objectKey — a concurrent replace
// makes both the token check and the update miss, yielding STALE_DOCUMENT.
// Failure/cleanup order: upload the NEW object first; swap the DB reference in a
// guarded transaction; on stale/DB failure best-effort remove the NEW object;
// only AFTER a committed swap best-effort remove the OLD object (its failure
// never rolls back the successful replacement).

export type ReplaceProviderDocumentInput = {
  documentId: string;
  expectedVersionToken: string;
  originalFilename: string;
  declaredMimeType: string;
  bytes: ArrayBuffer;
};

class StaleReplacement extends Error {}

export async function replaceProviderDocument(input: ReplaceProviderDocumentInput): Promise<ProviderDocumentActionResult> {
  let provider;
  try {
    ({ provider } = await requireProvider());
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_PROVIDER_PROFILE" };
    if (error instanceof UnauthenticatedError) throw error;
    throw error;
  }

  // Gate 1A/1B SERVER invariant: replace is allowed ONLY while editable
  // (DRAFT or CHANGES_REQUESTED — see uploadProviderDocument). Rejected
  // server-side for every other status so a direct API call cannot bypass the UI.
  if (!isVerificationEditableStatus(provider.status)) {
    return { ok: false, error: "APPLICATION_LOCKED" };
  }

  const doc = await prisma.providerDocument.findUnique({ where: { id: input.documentId } });
  // Uniform 404 for missing OR not-owned — never reveal another provider's doc.
  if (!doc || doc.providerId !== provider.id) {
    return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  }
  if (documentVersionToken(doc.objectKey) !== input.expectedVersionToken) {
    return { ok: false, error: "STALE_DOCUMENT" };
  }

  const head = new Uint8Array(input.bytes);
  const validation = validateDocumentUpload({
    declaredMimeType: input.declaredMimeType,
    sizeBytes: input.bytes.byteLength,
    head,
  });
  if (!validation.ok) return { ok: false, error: validation.error as ProviderDocumentErrorCode };

  if (!isDocumentStorageConfigured()) return { ok: false, error: "STORAGE_NOT_CONFIGURED" };

  const newKey = buildDocumentObjectKey({
    providerId: provider.id,
    type: doc.type,
    ext: validation.ext,
    unique: randomUUID(),
  });

  try {
    await uploadPrivateObject({ objectKey: newKey, body: input.bytes, contentType: validation.mimeType });
  } catch (error) {
    logger.error("replaceProviderDocument.storage_failed", {
      documentId: doc.id,
      message: error instanceof Error ? error.message : String(error),
    });
    // Gate 0: same split as uploadProviderDocument — a failed private-bucket
    // write is UPLOAD_FAILED (actionable), not the generic UNKNOWN_ERROR.
    return { ok: false, error: "UPLOAD_FAILED" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.providerDocument.updateMany({
        where: { id: doc.id, objectKey: doc.objectKey }, // bound to the seen object
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
          action: "provider.document_replaced",
          entityType: "ProviderDocument",
          entityId: doc.id,
          previousValue: { status: doc.status },
          newValue: { status: "PENDING", type: doc.type },
        },
        tx
      );
    });
  } catch (error) {
    await removePrivateObject(newKey).catch(() => {}); // no orphan on stale/failure
    if (error instanceof StaleReplacement) return { ok: false, error: "STALE_DOCUMENT" };
    logger.error("replaceProviderDocument.db_failed", {
      documentId: doc.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  // Committed. Best-effort delete the OLD object — a failure here must NOT undo
  // the successful, durable replacement.
  await removePrivateObject(doc.objectKey).catch((error) => {
    logger.error("replaceProviderDocument.old_cleanup_failed", {
      documentId: doc.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  // Gate B2 — admin fan-out on a successful replacement (post-commit,
  // fire-and-forget: never fails or rolls back the durable replace). Static
  // content — no filename/size/contents in the notification body.
  try {
    await notifyAdminsOfProviderEvent(PROVIDER_NOTIFICATION_EVENT.DOCUMENT_REPLACED, {
      providerId: provider.id,
    });
  } catch (notifyError) {
    logger.error("replaceProviderDocument.notification_failed", {
      documentId: doc.id,
      message: notifyError instanceof Error ? notifyError.message : String(notifyError),
    });
  }

  return { ok: true };
}
