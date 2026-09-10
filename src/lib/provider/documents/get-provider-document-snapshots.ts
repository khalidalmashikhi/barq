import "server-only";
import type { ProviderDocumentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

// Internal read helper for the FUTURE assertProviderApprovable() gate (Gate 3).
// Returns just { type, status } for a provider's documents — enough for
// resolveRequiredDocumentBlockers() to decide approval completeness. No auth is
// performed here (it is an internal building block); every caller must already
// be authorized (Gate 3's gate runs under requireAdmin/approval context). NOT
// wired into approveProvider() in Gate 2.

// Phase 3B Phase 1 — `expiresAt` is included for the vertical compliance gate (expiry enforcement).
// The provider-type approval path ignores it, so its behavior is unchanged.
export type ProviderDocumentSnapshot = { type: string; status: ProviderDocumentStatus; expiresAt?: Date | null };

export async function getProviderDocumentSnapshots(providerId: string): Promise<ProviderDocumentSnapshot[]> {
  return prisma.providerDocument.findMany({
    where: { providerId },
    select: { type: true, status: true, expiresAt: true },
  });
}
