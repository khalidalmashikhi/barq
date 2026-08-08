import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { isCategoryEffectivelyVisible } from "./category-visibility-policy";

// Admin category preview read — Unified Preview System. Admin-gated
// (requireAdmin). Returns exactly the fields the Category model ACTUALLY has
// (confirmed: `name` bilingual Json, slug, parent self-relation, sortOrder,
// visibilityStatus, scheduledVisibleAt, services relation) — there is NO
// description and NO icon/media column, so none are fabricated here.
//
// EFFECTIVE VISIBILITY reuses the existing isCategoryEffectivelyVisible policy
// (not a second interpretation): a PUBLIC category is only effectively visible
// if its ancestors are too. MAX_CATEGORY_DEPTH is 2, so at most one ancestor
// (the parent) can gate it. `linkedPublishedServiceCount` mirrors what public
// discovery would surface (PUBLISHED services in this category). `sortOrder` +
// `siblingCount` give the ordering context among its siblings.

export type CategoryPreview = {
  id: string;
  name: { ar: string; en: string };
  slug: string;
  visibilityStatus: string;
  scheduledVisibleAt: Date | null;
  effectivelyVisible: boolean;
  parent: { name: { ar: string; en: string }; slug: string; visibilityStatus: string } | null;
  linkedPublishedServiceCount: number;
  sortOrder: number;
  siblingCount: number;
} | null;

export async function getCategoryPreview(categoryId: string): Promise<CategoryPreview> {
  await requireAdmin();

  if (!isValidUuid(categoryId)) {
    return null;
  }

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    include: { parent: { select: { name: true, slug: true, visibilityStatus: true } } },
  });

  if (!category) {
    return null;
  }

  const ancestorStatuses = category.parent ? [category.parent.visibilityStatus] : [];

  const [linkedPublishedServiceCount, siblingCount] = await Promise.all([
    prisma.service.count({ where: { categoryId, status: "PUBLISHED" } }),
    prisma.category.count({ where: { parentId: category.parentId } }),
  ]);

  return {
    id: category.id,
    name: category.name as { ar: string; en: string },
    slug: category.slug,
    visibilityStatus: category.visibilityStatus,
    scheduledVisibleAt: category.scheduledVisibleAt,
    effectivelyVisible: isCategoryEffectivelyVisible(category.visibilityStatus, ancestorStatuses),
    parent: category.parent
      ? {
          name: category.parent.name as { ar: string; en: string },
          slug: category.parent.slug,
          visibilityStatus: category.parent.visibilityStatus,
        }
      : null,
    linkedPublishedServiceCount,
    sortOrder: category.sortOrder,
    siblingCount,
  };
}
