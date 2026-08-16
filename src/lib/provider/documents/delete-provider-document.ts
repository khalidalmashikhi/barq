"use server";

import { prisma } from "@/lib/db";
import { requireProvider, UnauthenticatedError, ForbiddenError } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";
import { removePrivateObject } from "@/lib/storage/storage";
import { documentVersionToken } from "./document-version-token";
import type { ProviderDocumentActionResult } from "./provider-document-errors";

// Delete a provider document. Allowed only for PENDING/REJECTED — an APPROVED
// document is NOT deletable (deleting approved compliance evidence would
// undermine verification; it may only be replaced). RC3 concurrency: bound to
// the seen object via `expectedVersionToken` AND an atomic conditional delete on
// (id, objectKey, status ∈ {PENDING, REJECTED}); a concurrent replace/review
// makes it miss → STALE_DOCUMENT.

class StaleDelete extends Error {}

export async function deleteProviderDocument(input: {
  documentId: string;
  expectedVersionToken: string;
}): Promise<ProviderDocumentActionResult> {
  let provider;
  try {
    ({ provider } = await requireProvider());
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: "NO_PROVIDER_PROFILE" };
    if (error instanceof UnauthenticatedError) throw error;
    throw error;
  }

  // Gate 1A SERVER invariant: delete is allowed ONLY while DRAFT (see
  // uploadProviderDocument). Rejected server-side for every other status so a
  // direct API call cannot bypass the UI lock.
  if (provider.status !== "DRAFT") {
    return { ok: false, error: "APPLICATION_LOCKED" };
  }

  const doc = await prisma.providerDocument.findUnique({ where: { id: input.documentId } });
  if (!doc || doc.providerId !== provider.id) {
    return { ok: false, error: "DOCUMENT_NOT_FOUND" };
  }
  if (documentVersionToken(doc.objectKey) !== input.expectedVersionToken) {
    return { ok: false, error: "STALE_DOCUMENT" };
  }
  if (doc.status === "APPROVED") {
    return { ok: false, error: "NOT_DELETABLE" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.providerDocument.deleteMany({
        where: { id: doc.id, objectKey: doc.objectKey, status: { in: ["PENDING", "REJECTED"] } },
      });
      if (deleted.count === 0) throw new StaleDelete();
      await recordAuditEvent(
        {
          actorType: "PROVIDER",
          actorId: provider.id,
          action: "provider.document_deleted",
          entityType: "ProviderDocument",
          entityId: doc.id,
          previousValue: { status: doc.status, type: doc.type },
        },
        tx
      );
    });
  } catch (error) {
    if (error instanceof StaleDelete) return { ok: false, error: "STALE_DOCUMENT" };
    logger.error("deleteProviderDocument.db_failed", {
      documentId: doc.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "UNKNOWN_ERROR" };
  }

  // Committed. Best-effort remove the object; a failure never undoes the delete.
  await removePrivateObject(doc.objectKey).catch((error) => {
    logger.error("deleteProviderDocument.object_cleanup_failed", {
      documentId: doc.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  return { ok: true };
}
