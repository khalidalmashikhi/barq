import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// Admin Feature Flag list query — Phase 1.3 (Core Business Platform).
// Mirrors get-categories.ts's paginated filters-in/result-out shape.
//
// AUTH: requireAdmin() — this is an admin-management view; nothing about
// Feature Flags is customer-facing, so there is no separate public query.

export type FeatureFlagListItem = {
  id: string;
  key: string;
  enabled: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FeatureFlagListFilters = {
  q?: string;
  page?: number;
  pageSize?: number;
};

export type FeatureFlagListResult = {
  items: FeatureFlagListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getFeatureFlags(filters: FeatureFlagListFilters = {}): Promise<FeatureFlagListResult> {
  await requireAdmin();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  const where = filters.q
    ? {
        OR: [
          { key: { contains: filters.q, mode: "insensitive" as const } },
          { description: { contains: filters.q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [totalCount, flags] = await Promise.all([
    prisma.featureFlag.count({ where }),
    prisma.featureFlag.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    items: flags,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
