import "server-only";
import type { ProviderType } from "@prisma/client";
import {
  resolveRequiredKeysFromPolicy,
  resolveSubmitBlockers,
  type SubmitBlocker,
  type VerificationRequirementPolicyRow,
} from "@/lib/provider-document-types";
import { getProviderDocumentSnapshots } from "./get-provider-document-snapshots";
import { getActiveVerificationRequirements } from "./get-active-verification-requirements";

// Gate 1A SUBMIT-readiness gate — the server-authoritative check behind
// "Submit for verification". DISTINCT from assertProviderApprovable (the admin
// APPROVAL gate): this asserts only that every REQUIRED document is PRESENT and
// not admin-REJECTED (a PENDING/APPROVED document satisfies submission). It makes
// no claim about semantic type or expiry — that is Gate 1C.
//
// Reuses the SAME fail-closed policy resolution as the approval gate
// (getActiveVerificationRequirements + resolveRequiredKeysFromPolicy), so a config
// problem tightens (falls back to code defaults), never relaxes, the required set.

export type { SubmitBlocker };

export async function assertReadyToSubmit(providerId: string, providerType: ProviderType): Promise<SubmitBlocker[]> {
  const records = await getActiveVerificationRequirements();
  const policyRows: VerificationRequirementPolicyRow[] | null =
    records === null
      ? null
      : records.map((r) => ({ key: r.key, appliesTo: r.appliesTo, required: r.required, active: r.active }));

  const requiredTypes = resolveRequiredKeysFromPolicy(policyRows, { providerType });
  const snapshots = await getProviderDocumentSnapshots(providerId);
  return resolveSubmitBlockers(requiredTypes, snapshots);
}
