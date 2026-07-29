import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { ServiceStatus } from "@prisma/client";

// Admin Service list query — Phase 2.3 (Service Foundation). Mirrors
// get-providers.ts's filters-in/paginated-result-out shape, using the
// same bilingual JSON-path search strategy for `name`. Distinct from
// the pre-existing public src/lib/services/get-services.ts, which is
// hardcoded to status: PUBLISHED for Marketplace browsing — this is
// the general admin-management list across every status.
//
// AUTH: requireAdmin() — admin-management view, not the public
// Marketplace browsing surface this phase explicitly excludes.

export type ServiceListItem = {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  status: string;
  activePrice: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ServiceListFilters = {
  q?: string;
  status?: ServiceStatus;
  providerId?: string;
  page?: number;
  pageSize?: number;
};

export type ServiceListResult = {
  items: ServiceListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getServices(filters: ServiceListFilters = {}): Promise<ServiceListResult> {
  await requireAdmin();
  const locale = await getLocale();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Same JSON-path search strategy as get-providers.ts/get-categories.ts.
  const searchClause = filters.q
    ? {
        OR: [
          { name: { path: ["ar"], string_contains: filters.q } },
          { name: { path: ["en"], string_contains: filters.q } },
        ],
      }
    : {};

  const where = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.providerId ? { providerId: filters.providerId } : {}),
    ...searchClause,
  };

  const [totalCount, services] = await Promise.all([
    prisma.service.count({ where }),
    prisma.service.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        provider: true,
        prices: { where: { status: "ACTIVE" }, take: 1 },
      },
    }),
  ]);

  type ServiceRow = {
    id: string;
    name: unknown;
    providerId: string;
    provider: { businessName: unknown };
    status: string;
    prices: Array<{ amount: unknown; currency: string }>;
    createdAt: Date;
    updatedAt: Date;
  };

  const items: ServiceListItem[] = (services as ServiceRow[]).map((service) => ({
    id: service.id,
    name: extractLocalizedText(service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    providerId: service.providerId,
    providerName: extractLocalizedText(service.provider.businessName, locale) || (locale === "ar" ? "مزود خدمة" : "Service Provider"),
    status: service.status,
    activePrice: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
