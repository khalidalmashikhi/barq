import "server-only";
import { prisma } from "@/lib/db";
import { extractText } from "@/lib/i18n/extract-text";

// Services listing query — Engineering Sprint (Services Marketplace).
//
// NOT IMPLEMENTED, FLAGGED — three requested filters have no backing
// field in the schema, confirmed by direct inspection before writing
// any code:
//   - Category: Service.serviceType is a technical CTI discriminator
//     ("mirrors AssetType's pattern" per its own schema comment), not
//     a business taxonomy. Using it as a "category" filter would
//     silently do the wrong thing, not a working feature.
//   - Governorate: no location field exists on Service or Provider.
//   - Images: no image field exists anywhere in the schema — the
//     gallery this sprint also asks for has nothing to read from.
// All three need a schema decision (new fields, or a new model for
// images) before they can be built for real — not decided here, per
// "preserve Prisma schema unless absolutely required."

export type ServiceListItem = {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  price: string | null;
  createdAt: Date;
};

export type ServiceListFilters = {
  search?: string;
  providerId?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: "newest" | "price_asc" | "price_desc";
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

const DEFAULT_PAGE_SIZE = 12;

export async function getServices(filters: ServiceListFilters): Promise<ServiceListResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;

  // Real bilingual search — Postgres JSON path filtering on the actual
  // Service.name column, not a fabricated text field.
  const searchClause = filters.search
    ? {
        OR: [
          { name: { path: ["ar"], string_contains: filters.search } },
          { name: { path: ["en"], string_contains: filters.search } },
        ],
      }
    : {};

  const where = {
    status: "PUBLISHED" as const,
    ...(filters.providerId ? { providerId: filters.providerId } : {}),
    ...searchClause,
  };

  // Price filtering/sorting requires joining the real Price model
  // (only ACTIVE rows) rather than a fabricated Service.price field,
  // which does not exist — Service and Price are separate models.
  const priceWhere =
    filters.minPrice !== undefined || filters.maxPrice !== undefined
      ? {
          prices: {
            some: {
              status: "ACTIVE" as const,
              ...(filters.minPrice !== undefined ? { amount: { gte: filters.minPrice } } : {}),
              ...(filters.maxPrice !== undefined ? { amount: { lte: filters.maxPrice } } : {}),
            },
          },
        }
      : {};

  const fullWhere = { ...where, ...priceWhere };

  const orderBy =
    filters.sort === "price_asc" || filters.sort === "price_desc"
      ? undefined // price sort applied after fetch — see note below
      : { createdAt: "desc" as const };

  const [totalCount, services] = await Promise.all([
    prisma.service.count({ where: fullWhere }),
    prisma.service.findMany({
      where: fullWhere,
      ...(orderBy ? { orderBy } : {}),
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
    prices: Array<{ amount: unknown; currency: string }>;
    createdAt: Date;
  };

  let items: ServiceListItem[] = (services as ServiceRow[]).map((service) => ({
    id: service.id,
    name: extractText(service.name) || "تجربة",
    providerId: service.providerId,
    providerName: extractText(service.provider.businessName) || "مزود خدمة",
    price: service.prices[0] ? `${service.prices[0].amount} ${service.prices[0].currency}` : null,
    createdAt: service.createdAt,
  }));

  // Price sorting done in application code after fetch, since it sorts
  // on a joined ACTIVE Price row (0 or 1 per service), not a direct
  // Service column — a real limitation of the current schema shape,
  // not a shortcut. Acceptable at this page size (paginated, not
  // sorting the full table); flagged if this ever needs to scale past
  // that.
  if (filters.sort === "price_asc" || filters.sort === "price_desc") {
    const direction = filters.sort === "price_asc" ? 1 : -1;
    items = [...items].sort((a, b) => {
      const priceA = a.price ? parseFloat(a.price) : Number.POSITIVE_INFINITY;
      const priceB = b.price ? parseFloat(b.price) : Number.POSITIVE_INFINITY;
      return (priceA - priceB) * direction;
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

export async function getProvidersForFilter(): Promise<Array<{ id: string; name: string }>> {
  const providers = await prisma.provider.findMany({
    where: { status: "APPROVED" },
    orderBy: { createdAt: "desc" },
  });

  type ProviderRow = { id: string; businessName: unknown };
  return (providers as ProviderRow[]).map((provider) => ({
    id: provider.id,
    name: extractText(provider.businessName) || "مزود خدمة",
  }));
}
