import "server-only";
import { prisma } from "@/lib/db";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isCategoryEffectivelyVisible } from "@/lib/categories/category-visibility-policy";
import type { Locale } from "@/i18n/locales";

// Provider "areas of activity" reads (Gap G). Two shapes:
//  - getProviderCategoryIds: the raw selected ids, for pre-checking the
//    multi-select on the provider's own settings/onboarding form.
//  - getProviderCategoryChips: locale-resolved { id, label } for the PUBLIC
//    provider profile — filtered to effectively-visible categories only (a
//    category later hidden/archived by an admin drops off the public profile
//    without unlinking the provider), preserving the taxonomy visibility rules.

export async function getProviderCategoryIds(providerId: string): Promise<string[]> {
  const links = await prisma.providerCategory.findMany({
    where: { providerId },
    select: { categoryId: true },
  });
  return links.map((link) => link.categoryId);
}

export type ProviderCategoryChip = { id: string; slug: string; label: string };

export async function getProviderCategoryChips(providerId: string, locale: Locale): Promise<ProviderCategoryChip[]> {
  const links = await prisma.providerCategory.findMany({
    where: { providerId },
    select: {
      category: {
        select: {
          id: true,
          slug: true,
          name: true,
          sortOrder: true,
          visibilityStatus: true,
          parent: { select: { visibilityStatus: true } },
        },
      },
    },
    orderBy: { category: { sortOrder: "asc" } },
  });

  return links
    .filter((link) =>
      isCategoryEffectivelyVisible(
        link.category.visibilityStatus,
        link.category.parent ? [link.category.parent.visibilityStatus] : []
      )
    )
    .map((link) => ({
      id: link.category.id,
      slug: link.category.slug,
      label: extractLocalizedText(link.category.name, locale) || link.category.slug,
    }));
}
