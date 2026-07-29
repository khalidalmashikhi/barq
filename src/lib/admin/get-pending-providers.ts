import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";

// Pending providers query — Phase 4.1 ("Complete the Booking
// Lifecycle"), requirement #6. Lists providers awaiting the minimum
// admin approval workflow — mirrors getProviderBookings()'s own
// "resolves auth internally via requireX(), never accepts a caller-
// supplied identity" pattern, now for the Admin role.

export type PendingProviderListItem = {
  id: string;
  businessName: string;
  status: string;
  createdAt: Date;
};

export async function getPendingProviders(): Promise<PendingProviderListItem[]> {
  await requireAdmin();
  const locale = await getLocale();

  const providers = await prisma.provider.findMany({
    where: { status: { in: ["APPLIED", "UNDER_REVIEW"] } },
    orderBy: { createdAt: "asc" },
  });

  type ProviderRow = { id: string; businessName: unknown; status: string; createdAt: Date };

  return (providers as ProviderRow[]).map((provider) => ({
    id: provider.id,
    businessName: extractLocalizedText(provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    status: provider.status,
    createdAt: provider.createdAt,
  }));
}
