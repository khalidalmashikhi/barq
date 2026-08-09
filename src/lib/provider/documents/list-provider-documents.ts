import "server-only";
import type { ProviderDocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { documentVersionToken } from "./document-version-token";

// List the AUTHENTICATED provider's own verification documents — Gate 2.
// Returns UI-safe rows: the raw private `objectKey` is NEVER included; instead
// each row carries an opaque `versionToken` (derived from the current objectKey)
// for the RC3 concurrency binding on replace/delete. Identity comes only from
// requireProvider() (own documents only). requireProvider throws for a non-
// provider / SUSPENDED / DEACTIVATED caller — the transport maps that to
// login/404.

export type ProviderDocumentListItem = {
  id: string;
  type: string;
  status: ProviderDocumentStatus;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  rejectionReason: string | null;
  versionToken: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function listOwnProviderDocuments(): Promise<ProviderDocumentListItem[]> {
  const { provider } = await requireProvider();

  const rows = await prisma.providerDocument.findMany({
    where: { providerId: provider.id },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    originalFilename: r.originalFilename,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    rejectionReason: r.rejectionReason,
    versionToken: documentVersionToken(r.objectKey),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}
