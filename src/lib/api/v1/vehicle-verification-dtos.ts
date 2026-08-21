import type { AssetStatus, AssetVerificationStatus, AssetDocumentStatus } from "@prisma/client";
import type { VehicleVerificationData } from "@/lib/vehicles/documents/get-asset-verification-data";

// VEHICLE-LC2B — the API v1 WIRE shape for a provider's vehicle verification state.
// A thin, EXPLICIT allowlist over the LC2 read model (VehicleVerificationData), which
// is itself already objectKey-free and admin-field-free. This mapper additionally:
//   - serializes Date → deterministic ISO-8601 strings (Swift/Kotlin friendly),
//   - names requirements by canonical `key` (not a UI label key),
//   - shapes each requirement's document as { id, status, rejectionReason, expiresAt }
//     or null, plus explicit capability booleans.
// It NEVER emits objectKey, bucket, a permanent/persisted URL, reviewedByAdminId, an
// internal providerId, or a raw Prisma row. The two axes stay SEPARATE:
// operationalStatus (AssetStatus) vs verificationStatus (AssetVerificationStatus).

export type VehicleVerificationRequirementDTO = {
  key: string;
  required: boolean;
  /** VEHICLE-LC6 — whether this requirement carries a meaningful expiry date (drives the claim field). */
  supportsExpiry: boolean;
  document: {
    id: string;
    status: AssetDocumentStatus;
    rejectionReason: string | null;
    /** VEHICLE-LC6 — the provider's ADVISORY claimed expiry date ("YYYY-MM-DD"); never trusted. */
    claimedExpiryDate: string | null;
    /** TRUSTED expiry instant (admin-confirmed), ISO-8601; the only value that affects eligibility. */
    expiresAt: string | null;
    /** VEHICLE-LC4 — derived server-side (trusted expiresAt has lapsed); clients need not recompute. */
    isExpired: boolean;
    /** VEHICLE-LC5 — derived server-side: this required doc may be replaced to remediate an expired approved doc. */
    isRemediable: boolean;
  } | null;
  capabilities: {
    canUpload: boolean;
    canReplace: boolean;
    canDelete: boolean;
    canView: boolean;
  };
};

export type VehicleVerificationApiDTO = {
  vehicleId: string;
  operationalStatus: AssetStatus;
  verificationStatus: AssetVerificationStatus;
  verificationSubmittedAt: string | null;
  verificationReason: string | null;
  requirements: VehicleVerificationRequirementDTO[];
  submission: {
    canSubmit: boolean;
    blockers: { type: string; reason: "MISSING" | "REJECTED" }[];
  };
};

export function toVehicleVerificationApiDTO(vehicleId: string, data: VehicleVerificationData): VehicleVerificationApiDTO {
  return {
    vehicleId,
    operationalStatus: data.operationalStatus,
    verificationStatus: data.verificationStatus,
    verificationSubmittedAt: data.verificationSubmittedAt ? data.verificationSubmittedAt.toISOString() : null,
    verificationReason: data.verificationReason,
    requirements: data.items.map((item) => ({
      key: item.type,
      required: item.required,
      supportsExpiry: item.supportsExpiry,
      document:
        item.documentId && item.status
          ? {
              id: item.documentId,
              status: item.status,
              rejectionReason: item.rejectionReason,
              claimedExpiryDate: item.claimedExpiryDate,
              expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
              isExpired: item.isExpired,
              isRemediable: item.isRemediable,
            }
          : null,
      capabilities: {
        canUpload: item.canUpload,
        canReplace: item.canReplace,
        canDelete: item.canDelete,
        canView: item.canView,
      },
    })),
    submission: {
      canSubmit: data.submittable,
      blockers: data.submissionBlockers,
    },
  };
}
