import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// Admin Homepage Section list query — Phase 1.4 (Core Business Platform).
// Mirrors get-feature-flags.ts's paginated filters-in/result-out shape.
// Ordered by sortOrder (then createdAt) rather than createdAt desc, since
// sortOrder is the meaningful admin-facing order here (see
// reorder-homepage-section.ts).
//
// AUTH: requireAdmin() — this is an admin-management view; nothing about
// Homepage Sections is customer-facing yet, so there is no separate
// public query.

export type HomepageSectionListItem = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  visible: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type HomepageSectionListFilters = {
  q?: string;
  page?: number;
  pageSize?: number;
};

export type HomepageSectionListResult = {
  items: HomepageSectionListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getHomepageSections(filters: HomepageSectionListFilters = {}): Promise<HomepageSectionListResult> {
  await requireAdmin();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  const where = filters.q
    ? {
        OR: [
          { key: { contains: filters.q, mode: "insensitive" as const } },
          { label: { contains: filters.q, mode: "insensitive" as const } },
          { description: { contains: filters.q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [totalCount, sections] = await Promise.all([
    prisma.homepageSection.count({ where }),
    prisma.homepageSection.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: sections,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
