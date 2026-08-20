import "server-only";
import type { AssetVerificationStatus, AssetDocumentStatus, AssetStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import {
  requiredAssetDocumentTypesFor,
  ASSET_DOCUMENT_TYPE_LABEL_KEYS,
  type AssetDocumentTypeKey,
  type AssetDocumentLabelKey,
} from "./asset-document-types";
import { getVehicleVerificationSubmissionBlockers, type VehicleSubmissionBlocker } from "./asset-verification-submission";
import { isAssetVerificationEditable } from "./asset-verification-lifecycle";

// VEHICLE-LC2 — the provider-private verification READ MODEL for one owned
// vehicle. Ownership-scoped (foreign/missing → null). It answers the checklist +
// submission question in one place; the UI only renders. NEVER returns objectKey
// (or any storage/admin-only field) — a document is surfaced by id + status only,
// with a signed URL minted separately at view time.

export type VehicleVerificationChecklistItem = {
  type: AssetDocumentTypeKey;
  labelKey: AssetDocumentLabelKey;
  required: true;
  documentId: string | null;
  status: AssetDocumentStatus | null;
  rejectionReason: string | null;
  expiresAt: Date | null;
  canUpload: boolean;
  canReplace: boolean;
  canDelete: boolean;
  canView: boolean;
};

export type VehicleVerificationData = {
  /** Operational axis (AssetStatus) — SEPARATE from verificationStatus; never collapsed. */
  operationalStatus: AssetStatus;
  verificationStatus: AssetVerificationStatus;
  /** When the vehicle was last submitted for review; null if never submitted. */
  verificationSubmittedAt: Date | null;
  editable: boolean;
  submittable: boolean;
  submissionBlockers: VehicleSubmissionBlocker[];
  /** Admin changes-requested / rejection reason the owner must see; null otherwise. */
  verificationReason: string | null;
  items: VehicleVerificationChecklistItem[];
};

export async function getVehicleVerificationData(assetId: string): Promise<VehicleVerificationData | null> {
  if (!isValidUuid(assetId)) return null;

  const { provider } = await requireApprovedProvider();

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, providerId: provider.id, assetType: "VEHICLE" },
    select: {
      status: true, // operational AssetStatus (separate axis)
      verificationStatus: true,
      verificationSubmittedAt: true,
      verificationReason: true,
      // Deliberately NO objectKey.
      documents: { select: { id: true, type: true, status: true, rejectionReason: true, expiresAt: true } },
    },
  });
  if (!asset) return null;

  const editable = isAssetVerificationEditable(asset.verificationStatus);
  const requiredTypes = requiredAssetDocumentTypesFor("VEHICLE");
  const byType = new Map(asset.documents.map((d) => [d.type, d]));

  const items: VehicleVerificationChecklistItem[] = requiredTypes.map((type) => {
    const doc = byType.get(type);
    const isMutableDoc = doc ? doc.status === "PENDING" || doc.status === "REJECTED" : false;
    return {
      type,
      labelKey: ASSET_DOCUMENT_TYPE_LABEL_KEYS[type],
      required: true,
      documentId: doc?.id ?? null,
      status: doc?.status ?? null,
      rejectionReason: doc?.rejectionReason ?? null,
      expiresAt: doc?.expiresAt ?? null,
      canUpload: editable && !doc,
      canReplace: editable && isMutableDoc,
      canDelete: editable && isMutableDoc,
      canView: Boolean(doc),
    };
  });

  const submissionBlockers = getVehicleVerificationSubmissionBlockers(
    requiredTypes,
    asset.documents.map((d) => ({ type: d.type, status: d.status })),
  );

  return {
    operationalStatus: asset.status,
    verificationStatus: asset.verificationStatus,
    verificationSubmittedAt: asset.verificationSubmittedAt,
    editable,
    submittable: editable && submissionBlockers.length === 0,
    submissionBlockers,
    verificationReason: asset.verificationReason,
    items,
  };
}
