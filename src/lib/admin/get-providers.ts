import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { ProviderStatus } from "@prisma/client";

// Admin Provider list query — Phase 2 (Provider Foundation). Mirrors
// get-categories.ts's filters-in/paginated-result-out shape, using the
// same bilingual JSON-path search strategy for `businessName`. Distinct
// from get-pending-providers.ts (which stays as-is, hardcoded to
// APPLIED/UNDER_REVIEW for the existing approval-queue view) — this is
// the general admin-management list across every status.
//
// AUTH: requireAdmin() — admin-management view, not the public
// Marketplace browsing surface this phase explicitly excludes.

export type ProviderListItem = {
  id: string;
  businessName: string;
  slug: string | null;
  status: string;
  visible: boolean;
  city: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProviderListFilters = {
  q?: string;
  status?: ProviderStatus;
  page?: number;
  pageSize?: number;
};

export type ProviderListResult = {
  items: ProviderListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getProviders(filters: ProviderListFilters = {}): Promise<ProviderListResult> {
  await requireAdmin();
  const locale = await getLocale();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Same JSON-path search strategy as get-categories.ts/get-services.ts.
  const searchClause = filters.q
    ? {
        OR: [
          { businessName: { path: ["ar"], string_contains: filters.q } },
          { businessName: { path: ["en"], string_contains: filters.q } },
        ],
      }
    : {};

  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...searchClause,
  };

  const [totalCount, providers] = await Promise.all([
    prisma.provider.count({ where }),
    prisma.provider.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const items: ProviderListItem[] = providers.map((provider) => ({
    id: provider.id,
    businessName: extractLocalizedText(provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    slug: provider.slug,
    status: provider.status,
    visible: provider.visible,
    city: provider.city,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
