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
