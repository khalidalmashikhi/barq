import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { isCategoryEffectivelyVisible } from "./category-visibility-policy";

// Admin Category detail query — Phase 1.1, extended for the tree (ADR-0015).
// Returns raw bilingual Json (not locale-extracted) since this feeds an admin
// edit form that needs both languages simultaneously, unlike get-categories.ts's
// list view. `children` are this category's depth-1 sub-categories (a
// "sub-category" is just a child Category). `serviceTypeKey`/`parentId` are
// returned so the edit/detail UI can show the vertical and distinguish a root
// from a child.

export type CategoryDetail = {
  id: string;
  name: { ar: string; en: string };
  slug: string;
  serviceTypeKey: string;
  parentId: string | null;
  visibilityStatus: string;
  scheduledVisibleAt: Date | null;
  children: Array<{
    id: string;
    name: { ar: string; en: string };
    slug: string;
    visibilityStatus: string;
    scheduledVisibleAt: Date | null;
    effectivelyVisible: boolean;
  }>;
} | null;

export async function getCategoryDetail(categoryId: string): Promise<CategoryDetail> {
  await requireAdmin();

  if (!isValidUuid(categoryId)) {
    return null;
  }

  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    include: { children: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });

  if (!category) {
    return null;
  }

  return {
    id: category.id,
    name: category.name as { ar: string; en: string },
    slug: category.slug,
    serviceTypeKey: category.serviceTypeKey,
    parentId: category.parentId,
    visibilityStatus: category.visibilityStatus,
    scheduledVisibleAt: category.scheduledVisibleAt,
    children: category.children.map((child) => ({
      id: child.id,
      name: child.name as { ar: string; en: string },
      slug: child.slug,
      visibilityStatus: child.visibilityStatus,
      scheduledVisibleAt: child.scheduledVisibleAt,
      effectivelyVisible: isCategoryEffectivelyVisible(child.visibilityStatus, [category.visibilityStatus]),
    })),
  };
}
