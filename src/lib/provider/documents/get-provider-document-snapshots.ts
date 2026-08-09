import "server-only";
import type { ProviderDocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

// Internal read helper for the FUTURE assertProviderApprovable() gate (Gate 3).
// Returns just { type, status } for a provider's documents — enough for
// resolveRequiredDocumentBlockers() to decide approval completeness. No auth is
// performed here (it is an internal building block); every caller must already
// be authorized (Gate 3's gate runs under requireAdmin/approval context). NOT
// wired into approveProvider() in Gate 2.

export type ProviderDocumentSnapshot = { type: string; status: ProviderDocumentStatus };

export async function getProviderDocumentSnapshots(providerId: string): Promise<ProviderDocumentSnapshot[]> {
  return prisma.providerDocument.findMany({
    where: { providerId },
    select: { type: true, status: true },
  });
}
