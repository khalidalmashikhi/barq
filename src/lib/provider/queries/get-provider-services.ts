import "server-only";
import { prisma } from "@/lib/db";
import { requireProvider } from "@/lib/auth";
import { extractText } from "@/lib/i18n/extract-text";
import type { ServiceStatus } from "@prisma/client";

// Provider Services query — Provider Dashboard Phase 1b.
//
// AUTH: resolves provider.id internally via requireProvider() — never
// accepts a providerId parameter, applying the Security Hardening
// pass's lesson from the start rather than retrofitting it later.
//
// SEARCH STRATEGY, VERIFIED AND DELIBERATELY REUSED, NOT REDESIGNED:
// identical to get-services.ts's own JSON-path `string_contains` OR
// clause on name.ar/name.en — confirmed by direct inspection before
// writing this module, per explicit instruction not to introduce a
// different search implementation. KNOWN LIMITATION, inherited
// unchanged, recorded as accepted technical debt rather than solved
// here: schema.prisma's Service model indexes only providerId and
// status (@@index([providerId]), @@index([status])) — no index exists
// on the name JSON path, so this is a sequential JSON containment scan
// for both this query and the public one. Fixing this would need a
// schema-level decision (e.g. a GIN index or a denormalized searchable
// text column), out of scope for a read-only Phase 1b list.
//
// STATUS FILTER, DELIBERATELY THE OPPOSITE OF getServices(): shows all
// 4 ServiceStatus values by default (unlike the public marketplace's
// PUBLISHED-only filter) — a provider managing their own catalog needs
// to see DRAFT/PAUSED/ARCHIVED too, not just what's publicly visible.
// `status` narrows to exactly one value when provided.
//
// SORT: only newest/price_asc/price_desc — matching the public
// marketplace's own 3 options exactly, per explicit instruction to
// stay aligned (no "oldest" sort). Price sort is applied in
// application code after a paginated fetch, identical to
// get-services.ts's own approach and inheriting its same real
// limitation (a price-sorted page only reorders the rows already
// fetched for that page, not a globally price-correct ordering across
// pages) — reused for consistency, not fixed here, plus a stable `id`
// tie-break added on top (a small, additive refinement, not a
// divergence from the reused strategy itself).

export type ProviderServiceListFilters = {
  q?: string;
  status?: ServiceStatus;
  sort?: "newest" | "price_asc" | "price_desc";
  page?: number;
  pageSize?: number;
};

export type ProviderServiceListItem = {
  id: string;
  name: string;
  status: string;
  price: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProviderServiceListResult = {
  items: ProviderServiceListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const DEFAULT_PAGE_SIZE = 12;

export async function getProviderServices(filters: ProviderServiceListFilters): Promise<ProviderServiceListResult> {
  const { provider } = await requireProvider();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Identical JSON-path search strategy to get-services.ts — see
  // module note above.
  const searchClause = filters.q
    ? {
        OR: [
          { name: { path: ["ar"], string_contains: filters.q } },
          { name: { path: ["en"], string_contains: filters.q } },
        ],
      }
    : {};

  const where = {
    providerId: provider.id,
    ...(filters.status ? { status: filters.status } : {}),
    ...searchClause,
  };

  const orderBy =
    filters.sort === "price_asc" || filters.sort === "price_desc"
      ? undefined // price sort applied after fetch — see module note above
      : [{ createdAt: "desc" as const }, { id: "desc" as const }];

  const [totalCount, services] = await Promise.all([
    prisma.service.count({ where }),
    prisma.service.findMany({
      where,
      ...(orderBy ? { orderBy } : {}),
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { prices: { where: { status: "ACTIVE" }, take: 1 } },
    }),
  ]);

  type ServiceRow = {
    id: string;
    name: unknown;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    prices: Array<{ amount: unknown; currency: string }>;
  };

  let items: ProviderServiceListItem[] = (services as ServiceRow[]).map((service) => ({
    id: service.id,
    name: extractText(service.name) || "تجربة",
    status: service.status,
    price: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  }));

  if (filters.sort === "price_asc" || filters.sort === "price_desc") {
    const direction = filters.sort === "price_asc" ? 1 : -1;
    items = [...items].sort((a, b) => {
      const priceA = a.price ? parseFloat(a.price) : Number.POSITIVE_INFINITY;
      const priceB = b.price ? parseFloat(b.price) : Number.POSITIVE_INFINITY;
      if (priceA !== priceB) return (priceA - priceB) * direction;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
  }

  return {
    items,
    totalCount,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
  };
}
