import "server-only";
import { prisma } from "@/lib/db";
import {
  resolveRequiredKeysFromPolicy,
  resolveRequiredDocumentBlockers,
  type RequiredDocumentBlocker,
  type VerificationRequirementPolicyRow,
} from "@/lib/provider-document-types";
import { getProviderDocumentSnapshots } from "./get-provider-document-snapshots";
import { getActiveVerificationRequirements } from "./get-active-verification-requirements";

// Provider approval completeness gate — Gate 3, now wired to the ADR-0017
// configurable policy. Composes ONLY the already-built primitives (no second
// completeness engine); ENFORCEMENT stays here in code (BR-029) — the policy only
// changes WHICH keys count as required:
//   getActiveVerificationRequirements() -> configured rows | null (DB error)
//   resolveRequiredKeysFromPolicy() -> required keys (FAIL CLOSED to code
//     defaults when the policy is unreadable/unseeded; never "require nothing")
//   getProviderDocumentSnapshots() -> the provider's {type,status}
//   resolveRequiredDocumentBlockers() -> ordered blockers
//
// A blocker means a REQUIRED document is missing ("MISSING") or exists but is
// not APPROVED ("NOT_APPROVED"). Optional requirements (e.g. TOURISM_LICENCE) and
// missing logo/cover/portfolio/categories/description deliberately DO NOT block.
// Empty array = approvable. The CURRENT active policy is evaluated at approval
// time; already-APPROVED providers are never re-evaluated or auto-demoted here.
//
// Read-only and reusable: the approve mutation calls it to enforce server-side,
// and the admin detail page calls it to show blockers proactively.

export type { RequiredDocumentBlocker };

export async function assertProviderApprovable(providerId: string): Promise<RequiredDocumentBlocker[]> {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { providerType: true },
  });
  // A non-existent provider has no blockers to report here — approveProvider
  // handles PROVIDER_NOT_FOUND independently before it ever transitions.
  if (!provider) return [];

  // Read the configured policy (null on DB failure) and resolve the required
  // keys fail-closed. resolveRequiredKeysFromPolicy falls back to the code
  // defaults for a null/empty policy, so a config problem tightens, never relaxes.
  const records = await getActiveVerificationRequirements();
  const policyRows: VerificationRequirementPolicyRow[] | null =
    records === null
      ? null
      : records.map((r) => ({ key: r.key, appliesTo: r.appliesTo, required: r.required, active: r.active }));

  const requiredTypes = resolveRequiredKeysFromPolicy(policyRows, { providerType: provider.providerType });
  const snapshots = await getProviderDocumentSnapshots(providerId);
  return resolveRequiredDocumentBlockers(requiredTypes, snapshots);
}
