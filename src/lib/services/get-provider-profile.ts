import "server-only";
import { prisma } from "@/lib/db";
import { isValidUuid } from "@/lib/uuid";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { getProviderCategoryChips, type ProviderCategoryChip } from "@/lib/provider/get-provider-categories";
import { getProviderMedia } from "@/lib/provider/media/get-provider-media";
import type { Locale } from "@/i18n/locales";

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

// Shared row -> ProviderProfile mapping, used by BOTH the gated public read
// and the ungated preview read so their presentation shape is guaranteed
// identical (Unified Preview System). Aggregates here (published-service count,
// rating, category chips, media) do not depend on provider visibility, so they
// are correct for a not-yet-public provider too. Presentation only — it applies
// no visibility gate; the caller decides which provider row to pass.
async function buildProviderProfile(row: ProviderRow, localeOverride?: Locale): Promise<ProviderProfile> {
  const locale = localeOverride ?? (await getLocale());

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

// `localeOverride` (additive, optional): the `/api/v1` HTTP adapter passes an
// explicitly resolved locale; existing Web callers pass nothing and behave
// EXACTLY as before (getLocale()). getProviderProfileForPreview is intentionally
// left unchanged (web/admin preview only).
export async function getProviderProfile(idOrSlug: string, localeOverride?: Locale): Promise<ProviderProfile | null> {
  const provider = await prisma.provider.findFirst({
    where: {
      status: "APPROVED",
      visible: true,
      ...(isValidUuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }),
    },
  });

  if (!provider) return null;
  return buildProviderProfile(provider as ProviderRow, localeOverride);
}

// Unified Preview System — preview-capable read. IDENTICAL shape/mapping to
// getProviderProfile, but by id and WITHOUT the APPROVED+visible gate, so an
// authorized provider (self) or admin can preview a not-yet-public storefront
// (APPLIED/UNDER_REVIEW, or APPROVED-but-visible=false). This does NOT weaken
// getProviderProfile (its gate above is untouched) and no PUBLIC route calls
// this: authorization (provider self-context / admin RBAC) is enforced by the
// caller BEFORE this runs. Returns null only for a malformed id or a
// nonexistent provider.
export async function getProviderProfileForPreview(providerId: string): Promise<ProviderProfile | null> {
  if (!isValidUuid(providerId)) return null;

  const provider = await prisma.provider.findUnique({ where: { id: providerId } });
  if (!provider) return null;

  return buildProviderProfile(provider as ProviderRow);
}
