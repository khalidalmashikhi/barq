import "server-only";
import { prisma } from "@/lib/db";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isCategoryEffectivelyVisible } from "./category-visibility-policy";
import { publicCategoryWhere } from "./public-category-rule";

// Public, customer-facing category read (B2 Slice 1). Resolves a category SLUG
// (the stable, SEO-friendly URL token in `/services?category=<slug>`) to its id
// and locale-resolved label — but ONLY when the category is effectively PUBLIC
// (itself AND every ancestor). Returns null for an unknown slug OR a category
// hidden by itself/an ancestor; the caller then falls back to the legacy
// keyword bridge (dual read). No auth guard: it exposes only PUBLIC categories,
// which are the customer Marketplace surface.
//
// ANCESTOR DEPTH: at MAX_CATEGORY_DEPTH = 2 the only ancestor is the immediate
// parent, so the parent's status is the whole ancestor chain. If depth is ever
// raised, load the full ancestor path before the effective-visibility check.

export type PublicCategory = { id: string; slug: string; label: string };

export async function getPublicCategoryBySlug(slug: string): Promise<PublicCategory | null> {
  const category = await prisma.category.findFirst({
    where: { slug, ...publicCategoryWhere() },
    select: {
      id: true,
      slug: true,
      name: true,
      visibilityStatus: true,
      parent: { select: { visibilityStatus: true } },
    },
  });

  if (!category) return null;

  const effectivelyVisible = isCategoryEffectivelyVisible(
    category.visibilityStatus,
    category.parent ? [category.parent.visibilityStatus] : []
  );
  if (!effectivelyVisible) return null;

  const locale = await getLocale();
  return {
    id: category.id,
    slug: category.slug,
    label: extractLocalizedText(category.name, locale) || category.slug,
  };
}
