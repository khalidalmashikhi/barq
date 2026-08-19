import type { AssetStatus, AssetVerificationStatus, AssetDocumentStatus } from "@prisma/client";

// VEHICLE-LC1 — the ONE domain-authoritative rule for whether a vehicle is
// customer-selectable / public. It replaces the old status-only
// isVehicleSelectable(status) and follows assertServicePublishable()'s
// ordered-blocker-array shape: an empty array means selectable. FAIL-CLOSED — any
// missing/failed condition blocks. Pure and deterministic (no I/O): the caller
// resolves status + verificationStatus + required doc types + the asset's document
// snapshots and passes them in, so the whole policy is trivially unit-testable and
// there is never a duplicated check anywhere else.
//
// The TWO authoritative conditions (always enforced): operational Asset.status is
// ACTIVE, and the verification axis is APPROVED. On top of that, every REQUIRED
// document type must have an APPROVED, UNEXPIRED document. Expiry is COMPUTED here
// (no cron, no status mutation): an expired required document blocks selectability
// while the stored APPROVED verification is left untouched.

export type VehicleSelectabilityBlocker =
  | "NOT_ACTIVE"
  | "VERIFICATION_NOT_APPROVED"
  | "REQUIRED_DOCUMENT_MISSING"
  | "REQUIRED_DOCUMENT_NOT_APPROVED"
  | "REQUIRED_DOCUMENT_EXPIRED";

// A minimal snapshot of one persisted AssetDocument for the pure check — never
// carries objectKey or any private field.
export type SelectabilityDocumentSnapshot = {
  type: string;
  status: AssetDocumentStatus;
  expiresAt: Date | null;
};

export type VehicleSelectabilityInput = {
  status: AssetStatus;
  verificationStatus: AssetVerificationStatus;
  /** Required document type keys for this asset (from requiredAssetDocumentTypesFor). */
  requiredDocumentTypes: readonly string[];
  documents: readonly SelectabilityDocumentSnapshot[];
  /** Injectable clock for deterministic tests; defaults to now. */
  now?: Date;
};

export function getVehicleSelectabilityBlockers(input: VehicleSelectabilityInput): VehicleSelectabilityBlocker[] {
  const blockers: VehicleSelectabilityBlocker[] = [];

  if (input.status !== "ACTIVE") blockers.push("NOT_ACTIVE");
  if (input.verificationStatus !== "APPROVED") blockers.push("VERIFICATION_NOT_APPROVED");

  const now = input.now ?? new Date();
  // Each document-level blocker code appears at most once (a clean blocker set),
  // in a deterministic order, no matter how many required docs trip it.
  const docBlockers = new Set<VehicleSelectabilityBlocker>();
  for (const type of input.requiredDocumentTypes) {
    const doc = input.documents.find((d) => d.type === type);
    if (!doc) {
      docBlockers.add("REQUIRED_DOCUMENT_MISSING");
    } else if (doc.status !== "APPROVED") {
      docBlockers.add("REQUIRED_DOCUMENT_NOT_APPROVED");
    } else if (doc.expiresAt !== null && doc.expiresAt.getTime() <= now.getTime()) {
      docBlockers.add("REQUIRED_DOCUMENT_EXPIRED");
    }
  }
  for (const code of ["REQUIRED_DOCUMENT_MISSING", "REQUIRED_DOCUMENT_NOT_APPROVED", "REQUIRED_DOCUMENT_EXPIRED"] as const) {
    if (docBlockers.has(code)) blockers.push(code);
  }

  return blockers;
}

/** True only when there are zero blockers (fail-closed). */
export function isVehicleSelectable(input: VehicleSelectabilityInput): boolean {
  return getVehicleSelectabilityBlockers(input).length === 0;
}
