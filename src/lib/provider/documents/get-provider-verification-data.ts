import "server-only";
import type { ProviderType, ProviderDocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { isDocumentStorageConfigured } from "@/lib/storage/storage";
import {
  PROVIDER_DOCUMENT_TYPE_KEYS,
  requiredDocumentTypesFor,
  type ProviderDocumentTypeKey,
} from "@/lib/provider-document-types";
import { documentVersionToken } from "./document-version-token";

// Single provider-side read backing the /provider/verification page AND the
// dashboard readiness card — so the required/optional checklist is derived once,
// server-side, from the same requirement primitives (no duplicate logic in
// React). Own documents only (requireProvider). Never exposes objectKey — each
// uploaded document carries the opaque versionToken for replace/delete binding.

export type VerificationChecklistItem = {
  type: ProviderDocumentTypeKey;
  required: boolean;
  document: {
    id: string;
    status: ProviderDocumentStatus;
    originalFilename: string;
    sizeBytes: number;
    rejectionReason: string | null;
    versionToken: string;
  } | null;
};

export type ProviderVerificationData = {
  providerType: ProviderType;
  providerStatus: string;
  storageAvailable: boolean;
  items: VerificationChecklistItem[]; // required types first, then optional
  requiredTotal: number;
  requiredApproved: number;
};

export async function getProviderVerificationData(): Promise<ProviderVerificationData> {
  const { provider } = await requireProvider();

  const rows = await prisma.providerDocument.findMany({ where: { providerId: provider.id } });
  const byType = new Map(rows.map((r) => [r.type, r]));

  const required = requiredDocumentTypesFor({ providerType: provider.providerType });
  const requiredSet = new Set<string>(required);
  const optional = PROVIDER_DOCUMENT_TYPE_KEYS.filter((k) => !requiredSet.has(k));

  const items: VerificationChecklistItem[] = [...required, ...optional].map((type) => {
    const r = byType.get(type);
    return {
      type,
      required: requiredSet.has(type),
      document: r
        ? {
            id: r.id,
            status: r.status,
            originalFilename: r.originalFilename,
            sizeBytes: r.sizeBytes,
            rejectionReason: r.rejectionReason,
            versionToken: documentVersionToken(r.objectKey),
          }
        : null,
    };
  });

  const requiredApproved = required.filter((t) => byType.get(t)?.status === "APPROVED").length;

  return {
    providerType: provider.providerType,
    providerStatus: provider.status,
    storageAvailable: isDocumentStorageConfigured(),
    items,
    requiredTotal: required.length,
    requiredApproved,
  };
}
