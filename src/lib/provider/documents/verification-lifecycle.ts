import type { ProviderStatus } from "@prisma/client";

// Gate 1B — the lifecycle stages in which a provider may still EDIT their
// verification documents and (re-)submit: DRAFT (initial) and CHANGES_REQUESTED
// (an admin returned the submitted application for correction). Single source of
// truth shared by the server document-mutation guards (upload/replace/delete),
// the submit guard, and the provider-facing `editable` flag — so they can never
// drift. Pure/isomorphic (no I/O, no server-only). Every OTHER status
// (APPLIED, UNDER_REVIEW, APPROVED, REJECTED, SUSPENDED, DEACTIVATED) is locked.
export function isVerificationEditableStatus(status: ProviderStatus | string): boolean {
  return status === "DRAFT" || status === "CHANGES_REQUESTED";
}

export type VerificationMutationType = "upload" | "replace" | "delete";

// Server-authoritative document-mutation policy (targeted fix). The single
// decision point for whether a provider may upload/replace/delete a verification
// document, given the lifecycle stage, whether the requirement is REQUIRED, and
// whether a document already exists. `requirementRequired` and `documentExists`
// MUST be derived server-side (resolved policy + DB), never from client input.
//
//  DRAFT / CHANGES_REQUESTED   → fully editable (any mutation).
//  UNDER_REVIEW / APPLIED*     → LOCKED, with ONE narrow exception: the FIRST
//                                upload of an OPTIONAL requirement that has no
//                                document yet. Required docs stay locked;
//                                replace/delete stay locked; an existing optional
//                                doc cannot be re-uploaded/replaced/deleted.
//  APPROVED/REJECTED/SUSPENDED/DEACTIVATED → locked.
//  (*legacy APPLIED is treated as a submitted/locked state, like UNDER_REVIEW.)
export function canMutateVerificationDocument(params: {
  providerStatus: ProviderStatus | string;
  requirementRequired: boolean;
  documentExists: boolean;
  mutationType: VerificationMutationType;
}): boolean {
  const { providerStatus, requirementRequired, documentExists, mutationType } = params;

  if (isVerificationEditableStatus(providerStatus)) return true;

  if (providerStatus === "UNDER_REVIEW" || providerStatus === "APPLIED") {
    // Optional + missing → allow ONLY an initial upload. Everything else locked.
    return mutationType === "upload" && !requirementRequired && !documentExists;
  }

  return false;
}
