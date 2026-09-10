import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider, ForbiddenError } from "@/lib/auth";
import { canProviderRequestVertical } from "./vertical-policy";
import type { ProviderVerticalOrigin, ProviderVerticalStatus, ProviderVerticalType } from "@prisma/client";

// Phase 3B — Phase 1. Provider-facing read for the "request a vertical" surface. Uses the SAME gate
// as the request action (requireProvider + onboarding-eligibility), so a provider onboarding (not
// yet APPROVED) can see and request verticals, while a REJECTED account (or a missing profile) is
// refused with a ForbiddenError the page renders as a notice. SUSPENDED/DEACTIVATED never reach here
// (requireProvider throws first). Returns one row per supported vertical type — the ones the
// provider already holds (with status), plus the ones never requested (status null) — so the page
// renders the whole set and decides the affordance without any authority logic in the view.

export const SUPPORTED_VERTICALS: readonly ProviderVerticalType[] = ["TOURIST_GUIDE", "RENTAL_COMPANY"];

export interface MyVerticalRow {
  vertical: ProviderVerticalType;
  status: ProviderVerticalStatus | null; // null = never requested
  origin: ProviderVerticalOrigin | null;
  reason: string | null;
  requestedAt: Date | null;
  // Derived affordances (view-only sugar; the server action re-derives authority itself).
  canRequest: boolean; // never requested
  canResubmit: boolean; // CHANGES_REQUESTED / REJECTED → provider may correct and resubmit
}

export async function getMyProviderVerticals(): Promise<MyVerticalRow[]> {
  const { provider } = await requireProvider();
  // A REJECTED account can reach /provider/* but may not request verticals — surface it as the same
  // ForbiddenError the page already renders as an ineligibility notice (no authority logic in the view).
  if (!canProviderRequestVertical(provider.status)) {
    throw new ForbiddenError("Provider account is not eligible to request verticals", "PROVIDER_NOT_ELIGIBLE");
  }
  const rows = await prisma.providerVertical.findMany({
    where: { providerId: provider.id },
    select: { vertical: true, status: true, origin: true, reason: true, requestedAt: true },
  });
  const byType = new Map(rows.map((r) => [r.vertical, r]));

  return SUPPORTED_VERTICALS.map((vertical) => {
    const row = byType.get(vertical);
    const status = row?.status ?? null;
    return {
      vertical,
      status,
      origin: row?.origin ?? null,
      reason: row?.reason ?? null,
      requestedAt: row?.requestedAt ?? null,
      canRequest: status === null,
      canResubmit: status === "CHANGES_REQUESTED" || status === "REJECTED",
    };
  });
}
