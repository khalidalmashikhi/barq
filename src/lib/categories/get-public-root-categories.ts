import "server-only";
import { prisma } from "@/lib/db";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { publicCategoryWhere } from "./public-category-rule";
import type { Locale } from "@/i18n/locales";

// Public homepage taxonomy read (Gap A). Returns the admin-managed, PUBLIC ROOT
// categories for the homepage discovery grid, ordered by sortOrder (admin
// controls order + which are PUBLIC via the existing category admin). Roots have
// no ancestors, so own-status PUBLIC (the shared publicCategoryWhere rule) IS
// effective visibility — an archived/hidden root simply drops out. One bounded
// indexed query (visibilityStatus + parentId are both indexed), no N+1. `take`
// caps the homepage grid; deeper merchandising/curation is the future Placement
// phase's job (no showOnHomepage/isFeatured boolean here).

export type PublicRootCategory = { id: string; slug: string; label: string };

const HOMEPAGE_CATEGORY_LIMIT = 12;

// `localeOverride` (additive, optional): the `/api/v1` HTTP adapter passes an
// explicitly resolved locale; existing Web callers pass nothing and behave
// EXACTLY as before (getLocale()).
export async function getPublicRootCategories(localeOverride?: Locale): Promise<PublicRootCategory[]> {
  const locale = localeOverride ?? (await getLocale());

  const rows = await prisma.category.findMany({
    where: { ...publicCategoryWhere(), parentId: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    take: HOMEPAGE_CATEGORY_LIMIT,
    select: { id: true, slug: true, name: true },
  });

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    label: extractLocalizedText(row.name, locale) || row.slug,
  }));
}
