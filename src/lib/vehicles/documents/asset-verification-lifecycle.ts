import type { AssetVerificationStatus } from "@prisma/client";

// VEHICLE-LC2 — the verification stages in which a provider may EDIT their vehicle
// documents (upload/replace/delete) and (re-)submit: DRAFT (initial) and
// CHANGES_REQUESTED (admin returned it for correction). Mirrors the provider
// isVerificationEditableStatus precedent. Single source of truth for the mutation
// guards, the submit guard, and the provider-facing `editable` flag, so they can
// never drift. Every other status (SUBMITTED / APPROVED / REJECTED) is locked.
// Pure/isomorphic.
export function isAssetVerificationEditable(status: AssetVerificationStatus | string): boolean {
  return status === "DRAFT" || status === "CHANGES_REQUESTED";
}
