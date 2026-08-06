import "server-only";
import { prisma } from "@/lib/db";
import { getLocale } from "next-intl/server";
import { buildCategoryTree, type CategoryTreeRow } from "./build-category-tree";
import { selectableCategoryWhere, isCategoryEffectivelySelectable } from "./selectable-category-rule";
import type { CategoryTree } from "./category-tree";

// Selectable-category read for the Service category picker (Task B, WRITE path).
// Returns the tree of categories a service of `serviceType` may be filed under —
// effectively-PUBLIC (self + every ancestor) and matching the service's
// vertical. Both the coarse `where` and the effective-visibility predicate come
// from the one shared rule module, so the picker and the server-side assignment
// validator can never diverge.
//
// AUTH: intentionally unguarded here — it exposes only PUBLIC categories (the
// same set the public Marketplace will browse) and is always called from an
// already-authorized Server Component (requireApprovedProvider / requireAdmin).
//
// ANCESTOR DEPTH: at MAX_CATEGORY_DEPTH = 2 a category's only ancestor is its
// parent, so the parent's status is the whole ancestor chain. If depth is ever
// raised, this must load the full ancestor path before applying the predicate.

export async function getSelectableCategories(serviceType: string): Promise<CategoryTree> {
  const locale = await getLocale();

  const rows = await prisma.category.findMany({
    where: selectableCategoryWhere(serviceType),
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

  const selectable = rows.filter((row) =>
    isCategoryEffectivelySelectable(
      {
        visibilityStatus: row.visibilityStatus,
        serviceTypeKey: row.serviceTypeKey,
        ancestorStatuses: row.parent ? [row.parent.visibilityStatus] : [],
      },
      serviceType
    )
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
