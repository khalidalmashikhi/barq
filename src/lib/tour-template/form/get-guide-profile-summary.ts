import "server-only";
import { prisma } from "@/lib/db";
import type { Locale } from "@/i18n/locales";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { GuideProfileSummary } from "./guide-profile";

// Smart Tour-Guide Template — the guide-profile summary reader (TOUR-2). Reuses
// ONLY safe, already-public Provider data (name, city, logo, approval, aggregate
// rating) + a caller-supplied activity label — never verification/private data.
// The service form REFERENCES this; it is never duplicated into guidingContent.

export async function getGuideProfileSummary(
  providerId: string,
  locale: Locale,
  activityLabel: string | null
): Promise<GuideProfileSummary | null> {
  const [provider, ratingAggregate] = await Promise.all([
    prisma.provider.findUnique({
      where: { id: providerId },
      select: { businessName: true, city: true, logoUrl: true, status: true },
    }),
    prisma.rating.aggregate({
      where: { review: { providerId, moderationState: "PUBLISHED" } },
      _avg: { value: true },
      _count: { value: true },
    }),
  ]);

  if (!provider) return null;

  return {
    name: extractLocalizedText(provider.businessName, locale) || (locale === "ar" ? "مرشد" : "Guide"),
    logoUrl: provider.logoUrl,
    city: provider.city,
    averageRating: ratingAggregate._avg.value,
    reviewCount: ratingAggregate._count.value,
    isApproved: provider.status === "APPROVED",
    activityLabel,
  };
}
