import "server-only";
import { prisma } from "@/lib/db";
import { createSignedObjectUrl, isDocumentStorageConfigured } from "@/lib/storage/storage";
import { sanitizeOriginalFilename } from "./document-object-key";

// Authorized signed-URL minting for viewing a private document — Gate 2.
// The transport resolves the CALLER (owning provider, via requireProvider, or an
// admin, via requireAdmin) and passes it here; this enforces ownership (a
// provider may only view their own document) and mints a SHORT-LIVED signed URL.
// Returns null for missing / not-owned / storage-not-configured so the transport
// can respond with a UNIFORM 404 that never reveals a document's existence. The
// raw objectKey is never returned; the signed URL is never persisted.

export const SIGNED_URL_TTL_SECONDS = 60;

export type DocumentCaller = { kind: "provider"; providerId: string } | { kind: "admin" };

export type SignedDocumentView = { signedUrl: string; filename: string };

export async function getProviderDocumentSignedUrl(
  documentId: string,
  caller: DocumentCaller
): Promise<SignedDocumentView | null> {
  const doc = await prisma.providerDocument.findUnique({
    where: { id: documentId },
    select: { objectKey: true, providerId: true, originalFilename: true },
  });
  if (!doc) return null;
  if (caller.kind === "provider" && doc.providerId !== caller.providerId) return null;
  if (!isDocumentStorageConfigured()) return null;

  const filename = sanitizeOriginalFilename(doc.originalFilename);
  const signedUrl = await createSignedObjectUrl(doc.objectKey, SIGNED_URL_TTL_SECONDS, { downloadFilename: filename });
  return { signedUrl, filename };
}
