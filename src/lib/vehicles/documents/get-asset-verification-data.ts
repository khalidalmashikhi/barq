import "server-only";
import type { AssetVerificationStatus, AssetDocumentStatus, AssetStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireApprovedProvider } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import {
  requiredAssetDocumentTypesFor,
  ASSET_DOCUMENT_TYPE_LABEL_KEYS,
  assetDocumentTypeSupportsExpiry,
  type AssetDocumentTypeKey,
  type AssetDocumentLabelKey,
} from "./asset-document-types";
import { getVehicleVerificationSubmissionBlockers, type VehicleSubmissionBlocker } from "./asset-verification-submission";
import { isAssetVerificationEditable } from "./asset-verification-lifecycle";
import { isRequiredDocumentRemediable } from "./document-remediation";
import { isDocumentExpired } from "@/lib/vehicles/document-expiry";

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
  /** VEHICLE-LC6 — whether this document type carries a meaningful expiry date. */
  supportsExpiry: boolean;
  /** VEHICLE-LC6 — the provider's ADVISORY claimed expiry date ("YYYY-MM-DD"); never trusted. */
  claimedExpiryDate: string | null;
  /** TRUSTED expiry instant (admin-confirmed); the only value selectability/LC5 consult. */
  expiresAt: Date | null;
  /** VEHICLE-LC4 — derived (never stored): the trusted expiresAt has lapsed. */
  isExpired: boolean;
  /**
   * VEHICLE-LC5 — derived (never stored): this required document may be self-remediated
   * (replaced) even though the vehicle verification is APPROVED, because it is an expired
   * approved doc or a rejected LC5 replacement. Drives the provider "renew" affordance;
   * `canReplace` already reflects it. Always false in editable/other states.
   */
  isRemediable: boolean;
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
      documents: { select: { id: true, type: true, status: true, rejectionReason: true, claimedExpiryDate: true, expiresAt: true } },
    },
  });
  if (!asset) return null;

  const editable = isAssetVerificationEditable(asset.verificationStatus);
  const requiredTypes = requiredAssetDocumentTypesFor("VEHICLE");
  const byType = new Map(asset.documents.map((d) => [d.type, d]));
  const now = new Date();

  const items: VehicleVerificationChecklistItem[] = requiredTypes.map((type) => {
    const doc = byType.get(type);
    const isMutableDoc = doc ? doc.status === "PENDING" || doc.status === "REJECTED" : false;
    // LC5 — a required doc may be replaced under an APPROVED vehicle only when it is an
    // expired-approved or rejected remediation doc (isRequiredDocumentRemediable is false
    // in every editable/other state, so this composes cleanly with the LC2 rules).
    const remediable = doc
      ? isRequiredDocumentRemediable({
          verificationStatus: asset.verificationStatus,
          documentType: type,
          requiredTypes,
          documentStatus: doc.status,
          expiresAt: doc.expiresAt,
          now,
        })
      : false;
    return {
      type,
      labelKey: ASSET_DOCUMENT_TYPE_LABEL_KEYS[type],
      required: true,
      documentId: doc?.id ?? null,
      status: doc?.status ?? null,
      rejectionReason: doc?.rejectionReason ?? null,
      supportsExpiry: assetDocumentTypeSupportsExpiry(type),
      claimedExpiryDate: doc?.claimedExpiryDate ?? null,
      expiresAt: doc?.expiresAt ?? null,
      isExpired: isDocumentExpired(doc?.expiresAt ?? null, now),
      isRemediable: remediable,
      canUpload: editable && !doc,
      canReplace: (editable && isMutableDoc) || remediable,
      canDelete: editable && isMutableDoc, // LC5 never unlocks delete (a required doc must never go MISSING under APPROVED)
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
