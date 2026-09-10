import "server-only";
import { prisma } from "@/lib/db";
import type { ProviderVerticalOrigin, ProviderVerticalStatus, ProviderVerticalType } from "@prisma/client";

// Phase 3B — Phase 1. Admin read model: a provider's verticals for the review surface. Read-only
// projection (no authority derived here — the review server actions each enforce their own
// permission). Ordered by request time so the newest request sits last, matching the audit trail.

export interface AdminProviderVerticalItem {
  id: string;
  vertical: ProviderVerticalType;
  status: ProviderVerticalStatus;
  origin: ProviderVerticalOrigin;
  reason: string | null;
  requestedAt: Date;
  reviewedAt: Date | null;
  suspendedAt: Date | null;
}

export async function getProviderVerticals(providerId: string): Promise<AdminProviderVerticalItem[]> {
  return prisma.providerVertical.findMany({
    where: { providerId },
    orderBy: { requestedAt: "asc" },
    select: {
      id: true,
      vertical: true,
      status: true,
      origin: true,
      reason: true,
      requestedAt: true,
      reviewedAt: true,
      suspendedAt: true,
    },
  });
}
