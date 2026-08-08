import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { getProviderCategoryChips, type ProviderCategoryChip } from "@/lib/provider/get-provider-categories";
import { getProviderMedia } from "@/lib/provider/media/get-provider-media";

// Public provider profile (storefront) query — Marketplace Completion.
//
// Only APPROVED + visible providers are ever returned — status gates
// the real approval workflow (BR-001), visible is the independent
// marketplace-display toggle (Phase 2, Provider Foundation) an admin
// can use to hide an already-approved provider without touching its
// vetting history. A provider failing either check does not exist
// from this query's point of view, mirroring getServiceById()'s
// PUBLISHED-only gating.
//
// Looked up by slug when the identifier isn't a UUID (the stable,
// human-readable identifier this page's URL prefers); falls back to
// id when it is one, so a provider with no slug set yet is still
// reachable via a direct id link (e.g. from the service detail page).
//
// averageRating/reviewCount aggregate Rating through Review.providerId
// — a field whose own schema comment states it exists specifically
// "for Provider aggregate-rating queries" — this is that query.

export type ProviderProfile = {
  id: string;
  name: string;
  description: string;
  status: string;
  providerType: string;
  city: string | null;
  logoUrl: string | null;
  // Provider media (Gap C) — cover banner + portfolio gallery URLs.
  coverUrl: string | null;
  portfolio: string[];
  publishedServicesCount: number;
  averageRating: number | null;
  reviewCount: number;
  // Provider "areas of activity" (Gap G) — effectively-visible categories only.
  categories: ProviderCategoryChip[];
};

type ProviderRow = {
  id: string;
  businessName: unknown;
  businessDescription: unknown;
  status: string;
  providerType: string;
  city: string | null;
  logoUrl: string | null;
};

export async function getProviderProfile(idOrSlug: string): Promise<ProviderProfile | null> {
  const provider = await prisma.provider.findFirst({
    where: {
      status: "APPROVED",
      visible: true,
      ...(isValidUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }),
    },
  });

  if (!provider) return null;

  const row = provider as ProviderRow;
  const locale = await getLocale();

  const [publishedServicesCount, ratingAggregate, categories, media] = await Promise.all([
    prisma.service.count({ where: { providerId: row.id, status: "PUBLISHED" } }),
    prisma.rating.aggregate({
      where: { review: { providerId: row.id, moderationState: "PUBLISHED" } },
      _avg: { value: true },
      _count: { value: true },
    }),
    getProviderCategoryChips(row.id, locale),
    getProviderMedia(row.id),
  ]);

  return {
    id: row.id,
    name: extractLocalizedText(row.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    description: extractLocalizedText(row.businessDescription, locale),
    status: row.status,
    providerType: row.providerType,
    city: row.city,
    logoUrl: row.logoUrl,
    coverUrl: media.cover?.url ?? null,
    portfolio: media.portfolio.map((item) => item.url),
    publishedServicesCount,
    averageRating: ratingAggregate._avg.value,
    reviewCount: ratingAggregate._count.value,
    categories,
  };
}
