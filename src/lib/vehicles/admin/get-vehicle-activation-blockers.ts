import type { AssetStatus, AssetVerificationStatus, AssetDocumentStatus } from "@prisma/client";
import { requiredAssetDocumentTypesFor } from "@/lib/vehicles/documents/asset-document-types";
import { isDocumentExpired } from "@/lib/vehicles/document-expiry";

// VEHICLE-LC7 — the SINGLE authoritative "may an admin ACTIVATE this vehicle?"
// primitive. Pure / no I/O, so the admin read model (to gate the Activate control +
// list reasons) and the activate action (to enforce it) share ONE source of truth —
// no duplicated rules. Composes the SAME authorities the other axes use
// (requiredAssetDocumentTypesFor, isDocumentExpired), never a competing copy.
//
// TWO-AXIS + narrowest-transition policy (LC7):
//   • Operational: activation is REGISTERED → ACTIVE ONLY. No VERIFIED/DEACTIVATED/
//     UNDER_MAINTENANCE source is invented (those enum values are unused for assets
//     today — see the LC7 report). An already-ACTIVE vehicle is handled by the action
//     as ALREADY_ACTIVE, not here.
//   • Verification: verificationStatus MUST already be APPROVED. Approving verification
//     NEVER auto-activates (that stays a separate admin decision); this primitive only
//     REQUIRES the approval, it does not perform it.
//   • Document readiness: every REQUIRED document must be present, APPROVED, and
//     unexpired — the same fail-closed readiness LC1 selectability and LC3 approval use.
//
// DISTINCT from getVehicleSelectabilityBlockers: that one also requires Asset.status ==
// ACTIVE (the state activation PRODUCES) and is the customer-eligibility authority.
// Activation is the admin operational transition; selectability is derived after it and
// can still fail later (e.g. a document expires) WITHOUT any status mutation.

export const ACTIVATABLE_SOURCE_STATUS: AssetStatus = "REGISTERED";

export type VehicleActivationBlocker = {
  type: string; // requirement key for a document blocker; "" for whole-vehicle blockers
  reason:
    | "INVALID_OPERATIONAL_STATE"
    | "VERIFICATION_NOT_APPROVED"
    | "REQUIRED_DOCUMENT_MISSING"
    | "REQUIRED_DOCUMENT_NOT_APPROVED"
    | "REQUIRED_DOCUMENT_EXPIRED"
    | "INVALID_VEHICLE_DATA";
};

export type ActivationDocumentSnapshot = {
  type: string;
  status: AssetDocumentStatus;
  expiresAt: Date | null;
};

export function getVehicleActivationBlockers(input: {
  operationalStatus: AssetStatus;
  verificationStatus: AssetVerificationStatus;
  /** Whether the Vehicle detail row exists (a VEHICLE asset must have one). */
  hasVehicleData: boolean;
  documents: ActivationDocumentSnapshot[];
  now?: Date;
}): VehicleActivationBlocker[] {
  const now = input.now ?? new Date();
  const blockers: VehicleActivationBlocker[] = [];

  // Only a REGISTERED vehicle may be activated (narrowest safe LC7 transition).
  if (input.operationalStatus !== ACTIVATABLE_SOURCE_STATUS) {
    blockers.push({ type: "", reason: "INVALID_OPERATIONAL_STATE" });
  }

  // Verification must already be APPROVED — activation never implies it, and never
  // approves it.
  if (input.verificationStatus !== "APPROVED") {
    blockers.push({ type: "", reason: "VERIFICATION_NOT_APPROVED" });
  }

  if (!input.hasVehicleData) {
    blockers.push({ type: "", reason: "INVALID_VEHICLE_DATA" });
  }

  const byType = new Map(input.documents.map((d) => [d.type, d]));
  for (const type of requiredAssetDocumentTypesFor("VEHICLE")) {
    const doc = byType.get(type);
    if (!doc) {
      blockers.push({ type, reason: "REQUIRED_DOCUMENT_MISSING" });
    } else if (doc.status !== "APPROVED") {
      blockers.push({ type, reason: "REQUIRED_DOCUMENT_NOT_APPROVED" });
    } else if (isDocumentExpired(doc.expiresAt, now)) {
      blockers.push({ type, reason: "REQUIRED_DOCUMENT_EXPIRED" });
    }
  }

  return blockers;
}
