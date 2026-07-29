import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isSubCategoryEffectivelyVisible } from "./category-visibility-policy";
import type { CategoryVisibilityStatus } from "@prisma/client";

// Admin Category list query — Phase 1.1 (Core Business Platform),
// extended Phase 1.2 (Category Admin UI) with search/filter/pagination —
// Phase 1.1 built this query before any UI consumed it, and Phase 1.2's
// own scope explicitly names Search/Filtering/Pagination as required
// admin capabilities. Mirrors get-provider-services.ts's own
// filters-in/paginated-result-out shape.
//
// AUTH: requireAdmin() — this is an admin-management view (every status,
// including HIDDEN/ARCHIVED), not the public Marketplace browsing surface
// this phase explicitly excludes. A customer-facing, PUBLIC-only query is a
// distinct future concern for the Marketplace context, not built here.

export type CategoryListSubItem = {
  id: string;
  name: string;
  slug: string;
  visibilityStatus: string;
  effectivelyVisible: boolean;
};

export type CategoryListItem = {
  id: string;
  name: string;
  slug: string;
  visibilityStatus: string;
  sortOrder: number;
  subCategories: CategoryListSubItem[];
  createdAt: Date;
  updatedAt: Date;
};

export type CategoryListFilters = {
  q?: string;
  visibilityStatus?: CategoryVisibilityStatus;
  page?: number;
  pageSize?: number;
};

export type CategoryListResult = {
  items: CategoryListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getCategories(filters: CategoryListFilters = {}): Promise<CategoryListResult> {
  await requireAdmin();
  const locale = await getLocale();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Same JSON-path search strategy as get-services.ts/get-provider-services.ts.
  const searchClause = filters.q
    ? {
        OR: [
          { name: { path: ["ar"], string_contains: filters.q } },
          { name: { path: ["en"], string_contains: filters.q } },
        ],
      }
    : {};

  const where = {
    ...(filters.visibilityStatus ? { visibilityStatus: filters.visibilityStatus } : {}),
    ...searchClause,
  };

  const [totalCount, categories] = await Promise.all([
    prisma.category.count({ where }),
    prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        subCategories: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    }),
  ]);

  const items: CategoryListItem[] = categories.map((category) => ({
    id: category.id,
    name: extractLocalizedText(category.name, locale) || category.slug,
    slug: category.slug,
    visibilityStatus: category.visibilityStatus,
    sortOrder: category.sortOrder,
    subCategories: category.subCategories.map((subCategory) => ({
      id: subCategory.id,
      name: extractLocalizedText(subCategory.name, locale) || subCategory.slug,
      slug: subCategory.slug,
      visibilityStatus: subCategory.visibilityStatus,
      effectivelyVisible: isSubCategoryEffectivelyVisible(subCategory.visibilityStatus, category.visibilityStatus),
    })),
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
