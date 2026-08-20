import type { AssetDocumentStatus } from "@prisma/client";

// VEHICLE-LC2 — the authoritative provider SUBMISSION-readiness primitive.
// DISTINCT from getVehicleSelectabilityBlockers (the CUSTOMER-selectability
// question): submission asks only whether the provider has done their part.
// Presence-only, mirroring the provider assert-ready-to-submit precedent: every
// REQUIRED document must be PRESENT and not admin-REJECTED — a PENDING (awaiting
// review) or APPROVED document satisfies submission. It makes no claim about
// operational status, verification approval, or expiry. Pure/no-I/O.

export type AssetDocumentSubmissionSnapshot = { type: string; status: AssetDocumentStatus };

export type VehicleSubmissionBlocker = { type: string; reason: "MISSING" | "REJECTED" };

export function getVehicleVerificationSubmissionBlockers(
  requiredTypes: readonly string[],
  documents: readonly AssetDocumentSubmissionSnapshot[],
): VehicleSubmissionBlocker[] {
  const blockers: VehicleSubmissionBlocker[] = [];
  for (const type of requiredTypes) {
    const doc = documents.find((d) => d.type === type);
    if (!doc) {
      blockers.push({ type, reason: "MISSING" });
    } else if (doc.status === "REJECTED") {
      // A rejected document must be replaced before the vehicle can be resubmitted.
      blockers.push({ type, reason: "REJECTED" });
    }
    // PENDING / APPROVED satisfy submission (admin hasn't reviewed a PENDING yet).
  }
  return blockers;
}
