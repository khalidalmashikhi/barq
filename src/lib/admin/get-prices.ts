import "server-only";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLocale } from "next-intl/server";
import { extractLocalizedText } from "@/lib/i18n/extract-localized-text";
import type { PriceStatus } from "@prisma/client";

// Admin Price list query — Phase 2.5 (Pricing Foundation). Mirrors
// get-services.ts's filters-in/paginated-result-out shape exactly.
// Every existing Price-reading query (get-services.ts,
// get-service-detail.ts, get-provider-service-detail.ts) only ever
// fetches the single current ACTIVE price for one Service as a joined
// field — none of them list Price rows as first-class entities across
// every status. This is that missing admin-management view.

export type PriceListItem = {
  id: string;
  serviceId: string;
  serviceName: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: Date;
};

export type PriceListFilters = {
  serviceId?: string;
  status?: PriceStatus;
  page?: number;
  pageSize?: number;
};

export type PriceListResult = {
  items: PriceListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 20;

export async function getPrices(filters: PriceListFilters = {}): Promise<PriceListResult> {
  await requireAdmin();
  const locale = await getLocale();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  const where = {
    ...(filters.serviceId ? { serviceId: filters.serviceId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  const [totalCount, prices] = await Promise.all([
    prisma.price.count({ where }),
    prisma.price.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { service: true },
    }),
  ]);

  type PriceRow = {
    id: string;
    serviceId: string;
    service: { name: unknown };
    amount: unknown;
    currency: string;
    status: string;
    createdAt: Date;
  };

  const items: PriceListItem[] = (prices as PriceRow[]).map((price) => ({
    id: price.id,
    serviceId: price.serviceId,
    serviceName: extractLocalizedText(price.service.name, locale) || (locale === "ar" ? "تجربة" : "Experience"),
    amount: String(price.amount),
    currency: price.currency,
    status: price.status,
    createdAt: price.createdAt,
  }));

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
