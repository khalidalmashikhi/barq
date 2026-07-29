import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { isValidUuid } from "@/lib/uuid";
import { isSubCategoryEffectivelyVisible } from "./category-visibility-policy";

// Admin Category detail query — Phase 1.1 (Core Business Platform).
// Returns raw bilingual Json (not locale-extracted) since this feeds an
// admin edit form that needs both languages simultaneously, unlike
// get-categories.ts's list view — same distinction get-provider-service-for-edit.ts
// already draws against get-provider-services.ts.

export type CategoryDetail = {
  id: string;
  name: { ar: string; en: string };
  slug: string;
  visibilityStatus: string;
  scheduledVisibleAt: Date | null;
  subCategories: Array<{
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
    include: { subCategories: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });

  if (!category) {
    return null;
  }

  return {
    id: category.id,
    name: category.name as { ar: string; en: string },
    slug: category.slug,
    visibilityStatus: category.visibilityStatus,
    scheduledVisibleAt: category.scheduledVisibleAt,
    subCategories: category.subCategories.map((subCategory) => ({
      id: subCategory.id,
      name: subCategory.name as { ar: string; en: string },
      slug: subCategory.slug,
      visibilityStatus: subCategory.visibilityStatus,
      scheduledVisibleAt: subCategory.scheduledVisibleAt,
      effectivelyVisible: isSubCategoryEffectivelyVisible(subCategory.visibilityStatus, category.visibilityStatus),
    })),
  };
}
