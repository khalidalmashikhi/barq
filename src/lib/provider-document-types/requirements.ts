import type { ProviderType, ProviderDocumentStatus } from "@prisma/client";
import type { ProviderDocumentTypeKey } from "./registry";

// Provider document REQUIREMENT rules — Provider Verification & Documents
// (Gate 1). Code-controlled (compliance-adjacent, so kept off the admin-editable
// side per 11-SECURITY-POLICY.md). Two pure, isomorphic pieces:
//
//  1. requiredDocumentTypesFor(provider) — which registry keys are REQUIRED,
//     keyed ONLY by the stable `ProviderType` axis. The public `Category`
//     taxonomy is deliberately never consulted (BR-024: Category is browse/SEO
//     only, admin-mutable — the wrong unit for compliance). The input is a small
//     provider-context shape, NOT a bare ProviderType, precisely so future
//     activity-specific rules (serviceType/categories) can be added here WITHOUT
//     changing the persistence model or any call site's shape.
//
//  2. resolveRequiredDocumentBlockers(...) — the pure completeness primitive the
//     FUTURE assertProviderApprovable() gate will use. NOT wired into
//     approveProvider() in Gate 1 (enforcement is a later, separately approved
//     change) — this only defines the reusable contract.
//
// TOURISM_LICENCE is a recognized registry type but is deliberately NOT required
// by either provider type in MVP: there is no repository-grounded basis for
// making it universally mandatory, so it stays uploadable/recognized without
// being an approval blocker.

export type ProviderRequirementContext = {
  providerType: ProviderType;
  // Future seam: activity-specific rules may read serviceType/category context
  // here without a schema change. Intentionally absent in MVP.
};

const REQUIRED_BY_PROVIDER_TYPE: Record<ProviderType, readonly ProviderDocumentTypeKey[]> = {
  INDIVIDUAL: ["IDENTITY_PROOF"],
  COMPANY: ["COMMERCIAL_REGISTRATION"],
};

/**
 * The document types REQUIRED for a provider, by ProviderType (MVP). Returns a
 * fresh array of stable registry keys; deterministic; no I/O.
 */
export function requiredDocumentTypesFor(provider: ProviderRequirementContext): ProviderDocumentTypeKey[] {
  return [...REQUIRED_BY_PROVIDER_TYPE[provider.providerType]];
}

/** Minimal snapshot of one persisted document, for the pure completeness check. */
export type ProviderDocumentSnapshot = { type: string; status: ProviderDocumentStatus };

export type RequiredDocumentBlocker = {
  // A plain `string`, not `ProviderDocumentTypeKey`: under ADR-0017 the required
  // set is admin-configured data, so a blocker may reference an admin-created key
  // that is not in the code registry. Historical/registry keys remain valid; the
  // UI applies a guarded label fallback (registry label if known, else the key).
  type: string;
  reason: "MISSING" | "NOT_APPROVED";
};

/**
 * Pure completeness primitive for the assertProviderApprovable() gate. Given the
 * required type keys (from the fail-closed policy resolver) and a snapshot of the
 * provider's documents, returns the ORDERED blockers (empty array = every
 * required document exists and is APPROVED), mirroring assertServicePublishable()'s
 * ordered-blocker shape. Optional documents (types not in `requiredTypes`) never
 * block. `requiredTypes` is `readonly string[]` because ADR-0017 keys are
 * admin-configured data, not only the code registry keys. No I/O.
 */
export function resolveRequiredDocumentBlockers(
  requiredTypes: readonly string[],
  documents: readonly ProviderDocumentSnapshot[]
): RequiredDocumentBlocker[] {
  const blockers: RequiredDocumentBlocker[] = [];
  for (const type of requiredTypes) {
    const doc = documents.find((d) => d.type === type);
    if (!doc) {
      blockers.push({ type, reason: "MISSING" });
    } else if (doc.status !== "APPROVED") {
      blockers.push({ type, reason: "NOT_APPROVED" });
    }
  }
  return blockers;
}

export type SubmitBlocker = {
  type: string;
  // MISSING: no document uploaded for this required type. REJECTED: a document
  // exists but an admin previously rejected it, so it must be replaced first.
  reason: "MISSING" | "REJECTED";
};

/**
 * Gate 1A SUBMIT-readiness primitive — DISTINCT from resolveRequiredDocumentBlockers
 * (which is the admin APPROVAL gate). Submission only checks document PRESENCE:
 * a required type is a blocker if no document exists (MISSING) or the existing one
 * was admin-REJECTED (must be replaced). A PENDING or APPROVED document satisfies
 * submission — the admin reviews/approves AFTER the provider submits.
 *
 * IMPORTANT (Gate 1A scope): this asserts document PRESENCE only. It makes NO
 * claim that the ID is the correct semantic type, non-expired, or otherwise valid
 * — automated document-type/expiry intelligence is Gate 1C. Optional documents
 * (types not in `requiredTypes`) never block. No I/O.
 */
export function resolveSubmitBlockers(
  requiredTypes: readonly string[],
  documents: readonly ProviderDocumentSnapshot[]
): SubmitBlocker[] {
  const blockers: SubmitBlocker[] = [];
  for (const type of requiredTypes) {
    const doc = documents.find((d) => d.type === type);
    if (!doc) {
      blockers.push({ type, reason: "MISSING" });
    } else if (doc.status === "REJECTED") {
      blockers.push({ type, reason: "REJECTED" });
    }
  }
  return blockers;
}
