import "server-only";
import type { AssetStatus, AssetVerificationStatus, AssetDocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { documentVersionToken } from "@/lib/provider/documents/document-version-token";
import {
  requiredAssetDocumentTypesFor,
  ASSET_DOCUMENT_TYPE_LABEL_KEYS,
  assetDocumentTypeSupportsExpiry,
  type AssetDocumentLabelKey,
} from "@/lib/vehicles/documents/asset-document-types";
import { omanValidThroughDateOfInstant } from "@/lib/date/oman-time";
import {
  getVehicleVerificationApprovalBlockers,
  type VehicleApprovalBlocker,
} from "./get-vehicle-verification-approval-blockers";
import { getVehicleActivationBlockers, type VehicleActivationBlocker } from "./get-vehicle-activation-blockers";

// VEHICLE-LC3 — the admin review DETAIL read model for one vehicle (ANY provider's;
// admin is globally authorized). requireAdmin()-gated. Surfaces the two axes
// SEPARATELY (operationalStatus vs verificationStatus), the private vehicle fields
// (registration is admin-authorized here), the required-document checklist with a
// per-document opaque versionToken for RC3-safe review, and the shared approval
// blockers. NEVER returns objectKey (only the versionToken hash) or reviewer ids.

export type AdminVehicleReviewDocument = {
  id: string;
  status: AssetDocumentStatus;
  rejectionReason: string | null;
  /** VEHICLE-LC6 — whether this document type carries a meaningful expiry date. */
  supportsExpiry: boolean;
  /** VEHICLE-LC6 — the provider's ADVISORY claimed expiry date ("YYYY-MM-DD") to verify. */
  claimedExpiryDate: string | null;
  /** TRUSTED expiry instant (admin-confirmed), if already set. */
  expiresAt: Date | null;
  /** VEHICLE-LC6 — the trusted expiry rendered as the Oman "valid through" date, to prefill the field. */
  trustedExpiryDate: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  reviewedAt: Date | null;
  versionToken: string;
};

export type AdminVehicleReviewItem = {
  type: string;
  labelKey: AssetDocumentLabelKey | null;
  required: boolean;
  document: AdminVehicleReviewDocument | null;
};

export type AdminVehicleReview = {
  id: string; // assetId
  operationalStatus: AssetStatus;
  verificationStatus: AssetVerificationStatus;
  verificationSubmittedAt: Date | null;
  verificationReviewedAt: Date | null;
  verificationReason: string | null;
  providerName: unknown; // bilingual {ar,en}
  vehicle: {
    make: string | null;
    model: string | null;
    modelYear: number | null;
    color: string | null;
    vehicleType: string | null;
    passengerCapacity: number | null;
    registrationNumber: string | null; // admin-authorized private field
    publicDescription: string | null;
    /** TOUR-VEHICLE-CAP — provider's advisory 4x4 declaration + the admin-confirmed trusted value. */
    claimedFourByFour: boolean | null;
    fourByFourVerified: boolean | null;
  } | null;
  items: AdminVehicleReviewItem[];
  approvalBlockers: VehicleApprovalBlocker[];
  /** VEHICLE-LC7 — operational-activation readiness (REGISTERED + APPROVED + docs valid). */
  activationBlockers: VehicleActivationBlocker[];
};

export async function getAdminVehicleReview(assetId: string): Promise<AdminVehicleReview | null> {
  await requireAdmin();
  if (!isValidUuid(assetId)) return null;

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, assetType: "VEHICLE" },
    select: {
      status: true,
      verificationStatus: true,
      verificationSubmittedAt: true,
      verificationReviewedAt: true,
      verificationReason: true,
      provider: { select: { businessName: true } },
      vehicle: {
        select: {
          make: true,
          model: true,
          modelYear: true,
          color: true,
          vehicleType: true,
          passengerCapacity: true,
          registrationNumber: true,
          publicDescription: true,
          claimedFourByFour: true,
          fourByFourVerified: true,
        },
      },
      documents: {
        select: {
          id: true,
          type: true,
          status: true,
          rejectionReason: true,
          claimedExpiryDate: true,
          expiresAt: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
          reviewedAt: true,
          objectKey: true, // used ONLY to derive versionToken; never returned
        },
      },
    },
  });
  if (!asset) return null;

  const toReviewDoc = (d: (typeof asset.documents)[number]): AdminVehicleReviewDocument => ({
    id: d.id,
    status: d.status,
    rejectionReason: d.rejectionReason,
    supportsExpiry: assetDocumentTypeSupportsExpiry(d.type),
    claimedExpiryDate: d.claimedExpiryDate,
    expiresAt: d.expiresAt,
    trustedExpiryDate: d.expiresAt ? omanValidThroughDateOfInstant(d.expiresAt) : null,
    originalFilename: d.originalFilename,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    createdAt: d.createdAt,
    reviewedAt: d.reviewedAt,
    versionToken: documentVersionToken(d.objectKey),
  });

  const byType = new Map(asset.documents.map((d) => [d.type, d]));
  const requiredTypes = requiredAssetDocumentTypesFor("VEHICLE");

  const items: AdminVehicleReviewItem[] = requiredTypes.map((type) => {
    const doc = byType.get(type);
    return {
      type,
      labelKey: ASSET_DOCUMENT_TYPE_LABEL_KEYS[type],
      required: true,
      document: doc ? toReviewDoc(doc) : null,
    };
  });

  // Any uploaded document whose type is not a current requirement — surface it so
  // the admin never loses sight of a submitted document (rare edge case).
  const requiredSet = new Set<string>(requiredTypes);
  for (const d of asset.documents) {
    if (!requiredSet.has(d.type)) {
      items.push({ type: d.type, labelKey: null, required: false, document: toReviewDoc(d) });
    }
  }

  const approvalBlockers = getVehicleVerificationApprovalBlockers({
    verificationStatus: asset.verificationStatus,
    hasVehicleData: asset.vehicle !== null,
    documents: asset.documents.map((d) => ({ type: d.type, status: d.status, expiresAt: d.expiresAt })),
  });

  const activationBlockers = getVehicleActivationBlockers({
    operationalStatus: asset.status,
    verificationStatus: asset.verificationStatus,
    hasVehicleData: asset.vehicle !== null,
    documents: asset.documents.map((d) => ({ type: d.type, status: d.status, expiresAt: d.expiresAt })),
  });

  return {
    id: assetId,
    operationalStatus: asset.status,
    verificationStatus: asset.verificationStatus,
    verificationSubmittedAt: asset.verificationSubmittedAt,
    verificationReviewedAt: asset.verificationReviewedAt,
    verificationReason: asset.verificationReason,
    providerName: asset.provider.businessName,
    vehicle: asset.vehicle,
    items,
    approvalBlockers,
    activationBlockers,
  };
}
