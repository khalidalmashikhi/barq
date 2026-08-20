import type { AssetVerificationStatus, AssetDocumentStatus } from "@prisma/client";

// VEHICLE-LC2 — presentation for the vehicle VERIFICATION axis, kept strictly
// separate from the operational AssetStatus (see vehicle-status.ts). Locale-
// INDEPENDENT: returns badge variant + translation key only, never text. This axis
// answers "where is this vehicle in BARQ review?" — it is NOT a claim of customer
// visibility (that is isVehicleSelectable(), which additionally needs ACTIVE +
// approved docs). Unknown values fall back to DRAFT.

const VERIFICATION_BADGE_VARIANT = {
  DRAFT: "default",
  SUBMITTED: "info",
  CHANGES_REQUESTED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
} as const satisfies Record<AssetVerificationStatus, "default" | "success" | "warning" | "danger" | "info">;

const VERIFICATION_TRANSLATION_KEYS = {
  DRAFT: "vehicleVerifyStatusDraft",
  SUBMITTED: "vehicleVerifyStatusSubmitted",
  CHANGES_REQUESTED: "vehicleVerifyStatusChangesRequested",
  APPROVED: "vehicleVerifyStatusApproved",
  REJECTED: "vehicleVerifyStatusRejected",
} as const satisfies Record<AssetVerificationStatus, string>;

export function getVehicleVerificationBadgeVariant(status: AssetVerificationStatus): "default" | "success" | "warning" | "danger" | "info" {
  return VERIFICATION_BADGE_VARIANT[status] ?? VERIFICATION_BADGE_VARIANT.DRAFT;
}

export function getVehicleVerificationTranslationKey(status: AssetVerificationStatus) {
  return VERIFICATION_TRANSLATION_KEYS[status] ?? VERIFICATION_TRANSLATION_KEYS.DRAFT;
}

const DOC_STATUS_BADGE_VARIANT = {
  PENDING: "info",
  APPROVED: "success",
  REJECTED: "danger",
} as const satisfies Record<AssetDocumentStatus, "success" | "warning" | "danger" | "info">;

const DOC_STATUS_TRANSLATION_KEYS = {
  PENDING: "vehicleDocStatusPending",
  APPROVED: "vehicleDocStatusApproved",
  REJECTED: "vehicleDocStatusRejected",
} as const satisfies Record<AssetDocumentStatus, string>;

export function getVehicleDocStatusBadgeVariant(status: AssetDocumentStatus): "default" | "success" | "warning" | "danger" | "info" {
  return DOC_STATUS_BADGE_VARIANT[status] ?? "info";
}

// null = no document uploaded yet ("Not uploaded").
export function getVehicleDocStatusTranslationKey(status: AssetDocumentStatus | null) {
  return status ? DOC_STATUS_TRANSLATION_KEYS[status] ?? "vehicleDocStatusMissing" : "vehicleDocStatusMissing";
}
