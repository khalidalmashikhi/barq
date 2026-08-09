import "server-only";
import type { ProviderDocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { documentVersionToken } from "./document-version-token";

// Admin view of ANY provider's verification documents — Gate 2. requireAdmin()
// gated (no new permission). Returns UI-safe rows including the opaque
// `versionToken` (for the admin review action's RC3 binding) but NEVER the raw
// objectKey. requireAdmin throws for non-admins — the transport maps to 404.

export type AdminProviderDocumentListItem = {
  id: string;
  providerId: string;
  type: string;
  status: ProviderDocumentStatus;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  reviewedByAdminId: string | null;
  versionToken: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function listProviderDocumentsForAdmin(providerId: string): Promise<AdminProviderDocumentListItem[]> {
  await requireAdmin();

  const rows = await prisma.providerDocument.findMany({
    where: { providerId },
    orderBy: { createdAt: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    providerId: r.providerId,
    type: r.type,
    status: r.status,
    originalFilename: r.originalFilename,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    rejectionReason: r.rejectionReason,
    reviewedAt: r.reviewedAt,
    reviewedByAdminId: r.reviewedByAdminId,
    versionToken: documentVersionToken(r.objectKey),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}
