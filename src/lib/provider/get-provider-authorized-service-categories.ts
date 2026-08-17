import "server-only";
import { prisma } from "@/lib/db";
import { getLocale } from "next-intl/server";
import { buildCategoryTree, type CategoryTreeRow } from "@/lib/categories/build-category-tree";
import { selectableCategoryWhere, isCategoryEffectivelySelectable } from "@/lib/categories/selectable-category-rule";
import type { CategoryTree } from "@/lib/categories/category-tree";

// Gate B5 — the service category picker's option source for a PROVIDER: the
// INTERSECTION of the two independent rules the write path enforces separately.
//
//   authorized  — the provider holds a ProviderCategory link (any provenance:
//                 SELF / ADMIN / LEGACY) for the category
//   assignable  — the category is effectively-PUBLIC and a governed vertical
//                 (getSelectableCategories' exact rule, reused here verbatim)
//
// So the provider is only OFFERED categories they can actually file a service
// under. This is a UX affordance, NOT the security boundary: the authoritative
// checks live in create-service / update-service / transition-service-status via
// isProviderAuthorizedForCategory + resolveAssignableCategory. A spoofed or stale
// categoryId that bypasses this picker is still rejected server-side.
//
// Historical note: an existing service may sit on a category the provider is no
// longer authorized for. That category simply will not appear here — but the
// edit form still round-trips its id through the hidden field, and the domain
// only re-checks authorization when the category actually CHANGES, so a
// metadata-only edit of such a service is never blocked.

export async function getProviderAuthorizedServiceCategories(providerId: string): Promise<CategoryTree> {
  const locale = await getLocale();

  // The provider's authorized set — every link, regardless of provenance.
  const links = await prisma.providerCategory.findMany({
    where: { providerId },
    select: { categoryId: true },
  });
  const authorizedIds = new Set(links.map((link) => link.categoryId));

  // No authorized activities → an empty picker (the CategorySelector renders its
  // "no categories" empty state). Skip the category query entirely.
  if (authorizedIds.size === 0) {
    return { locale, nodes: [] };
  }

  // The assignable universe — same coarse `where` + effective-visibility
  // predicate as getSelectableCategories(), so the picker and the server-side
  // assignment validator can never diverge on "assignable".
  const rows = await prisma.category.findMany({
    where: selectableCategoryWhere(),
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      parentId: true,
      sortOrder: true,
      visibilityStatus: true,
      serviceTypeKey: true,
      parent: { select: { visibilityStatus: true } },
    },
  });

  const selectable = rows.filter(
    (row) =>
      authorizedIds.has(row.id) &&
      isCategoryEffectivelySelectable({
        visibilityStatus: row.visibilityStatus,
        serviceTypeKey: row.serviceTypeKey,
        ancestorStatuses: row.parent ? [row.parent.visibilityStatus] : [],
      })
  );

  const treeRows: CategoryTreeRow[] = selectable.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
  }));

  return buildCategoryTree(treeRows, locale);
}
