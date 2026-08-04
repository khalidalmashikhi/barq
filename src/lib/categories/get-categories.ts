import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import { isCategoryEffectivelyVisible } from "./category-visibility-policy";
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
  serviceTypeKey: string;
  visibilityStatus: string;
  sortOrder: number;
  children: CategoryListSubItem[];
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
    // Only root categories are listed at the top level (ADR-0015); their
    // children are nested below via the `children` include. Search/visibility
    // filters apply to the roots, matching the pre-collapse behavior where the
    // list only ever showed top-level categories.
    parentId: null,
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
        children: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    }),
  ]);

  const items: CategoryListItem[] = categories.map((category) => ({
    id: category.id,
    name: extractLocalizedText(category.name, locale) || category.slug,
    slug: category.slug,
    serviceTypeKey: category.serviceTypeKey,
    visibilityStatus: category.visibilityStatus,
    sortOrder: category.sortOrder,
    children: category.children.map((child) => ({
      id: child.id,
      name: extractLocalizedText(child.name, locale) || child.slug,
      slug: child.slug,
      visibilityStatus: child.visibilityStatus,
      effectivelyVisible: isCategoryEffectivelyVisible(child.visibilityStatus, [category.visibilityStatus]),
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
