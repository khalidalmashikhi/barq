import "server-only";
import { prisma } from "@/lib/db";
import {
  requiredDocumentTypesFor,
  resolveRequiredDocumentBlockers,
  type RequiredDocumentBlocker,
} from "@/lib/provider-document-types";
import { getProviderDocumentSnapshots } from "./get-provider-document-snapshots";

// Provider approval completeness gate — Gate 3. Composes ONLY the already-built
// primitives (no second completeness engine):
//   provider.providerType -> requiredDocumentTypesFor() -> required keys
//   getProviderDocumentSnapshots() -> the provider's {type,status}
//   resolveRequiredDocumentBlockers() -> ordered blockers
//
// A blocker means a REQUIRED document is missing ("MISSING") or exists but is
// not APPROVED ("NOT_APPROVED"). Missing logo/cover/portfolio/categories/
// description and the optional TOURISM_LICENCE deliberately DO NOT block (they
// are advisory, handled elsewhere). Empty array = approvable.
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

  const requiredTypes = requiredDocumentTypesFor({ providerType: provider.providerType });
  const snapshots = await getProviderDocumentSnapshots(providerId);
  return resolveRequiredDocumentBlockers(requiredTypes, snapshots);
}
