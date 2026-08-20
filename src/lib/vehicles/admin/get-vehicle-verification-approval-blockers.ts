import type { AssetVerificationStatus, AssetDocumentStatus } from "@prisma/client";
import { requiredAssetDocumentTypesFor } from "@/lib/vehicles/documents/asset-document-types";

// VEHICLE-LC3 — the SINGLE authoritative "can an admin approve this vehicle's
// verification?" primitive. Pure / no I/O, so the admin read model (to disable the
// Approve button + list reasons) and the approve action (to enforce it) share ONE
// source of truth — no duplicated logic. Reuses the LC1 code-owned requirement
// registry (requiredAssetDocumentTypesFor); it invents no legal requirements.
//
// DISTINCT from getVehicleSelectabilityBlockers (customer selectability, which also
// needs Asset.status === ACTIVE): approval is only about the VERIFICATION axis.
// Approving verification NEVER implies operational ACTIVE — a REGISTERED + APPROVED
// vehicle is intentionally still not customer-selectable.

export type VehicleApprovalBlocker = {
  type: string; // the requirement key for a document blocker; "" for whole-vehicle blockers
  reason:
    | "REQUIRED_DOCUMENT_MISSING"
    | "REQUIRED_DOCUMENT_NOT_APPROVED"
    | "REQUIRED_DOCUMENT_EXPIRED"
    | "INVALID_VEHICLE_DATA"
    | "INVALID_VERIFICATION_STATE";
};

export type ApprovalDocumentSnapshot = {
  type: string;
  status: AssetDocumentStatus;
  expiresAt: Date | null;
};

export function getVehicleVerificationApprovalBlockers(input: {
  verificationStatus: AssetVerificationStatus;
  /** Whether the Vehicle detail row exists (a VEHICLE asset must have one). */
  hasVehicleData: boolean;
  documents: ApprovalDocumentSnapshot[];
  now?: Date;
}): VehicleApprovalBlocker[] {
  const now = input.now ?? new Date();
  const blockers: VehicleApprovalBlocker[] = [];

  // A decision (and specifically APPROVE) applies only to a SUBMITTED vehicle.
  if (input.verificationStatus !== "SUBMITTED") {
    blockers.push({ type: "", reason: "INVALID_VERIFICATION_STATE" });
  }

  // Core vehicle data integrity: a VEHICLE asset must have its Vehicle detail row.
  // Specific field-level requirements are deliberately NOT invented here.
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
    } else if (doc.expiresAt && doc.expiresAt.getTime() <= now.getTime()) {
      blockers.push({ type, reason: "REQUIRED_DOCUMENT_EXPIRED" });
    }
  }

  return blockers;
}
