import type { AssetVerificationStatus, AssetDocumentStatus } from "@prisma/client";
import { isDocumentExpired } from "@/lib/vehicles/document-expiry";

// VEHICLE-LC5 — the SINGLE authoritative "may a provider REMEDIATE this required
// document?" primitive. Pure / no I/O, so the mutation guard (replaceVehicleDocument)
// and the provider read model (getVehicleVerificationData `canReplace` / `isRemediable`)
// share ONE source of truth and can never drift.
//
// LC5 is a DELIBERATELY NARROW exception layered ON TOP of the LC2 editability rules
// (isAssetVerificationEditable = DRAFT/CHANGES_REQUESTED). It applies ONLY to an
// already-APPROVED vehicle whose selectability is broken by an expired required
// document, and it unlocks ONLY a document REPLACEMENT (never upload/delete, never a
// verificationStatus change). The replacement returns to PENDING admin review before
// the vehicle can recover selectability (fail-closed — see getVehicleSelectabilityBlockers).
//
// The allowed document states are INTENTIONALLY ENUMERATED (not `!validForSelectability`),
// so a future unrelated selectability blocker can never silently widen who may mutate an
// APPROVED vehicle's documents. Every branch is test-pinned in document-remediation.test.ts.
//
//   verificationStatus !== APPROVED            -> NOT remediable (LC2 rules are authoritative)
//   document type not currently REQUIRED       -> NOT remediable (only a required doc blocks selectability)
//   APPROVED document, expiresAt <= now        -> REMEDIABLE (a genuinely expired required doc)
//   REJECTED document                          -> REMEDIABLE (an LC5 retry — see below)
//   PENDING document                           -> NOT remediable (in the admin's hands; fail-closed)
//   valid APPROVED (unexpired) document        -> NOT remediable (no arbitrary APPROVED-doc editing)
//
// Why REJECTED is safe to remediate under APPROVED: at the moment of approval every
// required document was APPROVED and unexpired (getVehicleVerificationApprovalBlockers).
// After approval the ONLY thing that can mutate a required document is this same LC5
// replacement (expired-APPROVED -> PENDING) followed by admin review (PENDING ->
// APPROVED/REJECTED). So a REJECTED required document under an APPROVED vehicle can only
// ever be a step of the LC5 remediation chain — enabling its retry can never unlock an
// unrelated / legacy rejected document.

export type RequiredDocumentRemediationInput = {
  verificationStatus: AssetVerificationStatus;
  documentType: string;
  requiredTypes: readonly string[];
  documentStatus: AssetDocumentStatus;
  expiresAt: Date | null;
  now: Date;
};

export function isRequiredDocumentRemediable(input: RequiredDocumentRemediationInput): boolean {
  // The exception exists ONLY for an already-APPROVED vehicle. Every editable/other
  // verification state keeps the LC2 rules (isAssetVerificationEditable) as authoritative.
  if (input.verificationStatus !== "APPROVED") return false;

  // Only a REQUIRED document type can block selectability, so only a required document
  // is ever remediable. A non-required (optional) document stays LOCKED under APPROVED.
  if (!input.requiredTypes.includes(input.documentType)) return false;

  switch (input.documentStatus) {
    case "APPROVED":
      // Only a genuinely expired approved document — a valid (unexpired) one stays LOCKED.
      return isDocumentExpired(input.expiresAt, input.now);
    case "REJECTED":
      // An LC5 retry (provably only reachable via the remediation chain, see header).
      return true;
    default:
      // PENDING (awaiting the admin's decision) / anything else — fail-closed LOCKED.
      return false;
  }
}
