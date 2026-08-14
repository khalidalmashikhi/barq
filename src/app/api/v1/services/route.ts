import { getServices, type ServiceListFilters } from "@/lib/services/get-services";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { resolveApiLocale } from "@/lib/api/v1/locale";
import { parsePageParams } from "@/lib/api/v1/pagination";
import { apiOk } from "@/lib/api/v1/respond";
import { toServiceSummaryDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/services — Gate 1 (Public API Foundation).
//
// Thin HTTP/DTO adapter over the EXISTING authoritative getServices() reader —
// it re-uses that function's publication + provider APPROVED/visible gate and
// all filter/pagination logic verbatim; NO visibility/pricing rule is
// reimplemented here. Public, no auth. Locale is resolved from the request
// (?locale → Accept-Language → ar) and passed explicitly to the reader.

export const dynamic = "force-dynamic";

const SERVICES_DEFAULT_PAGE_SIZE = 12;

function optionalNumber(raw: string | null): number | undefined {
  if (raw === null || raw.trim().length === 0) return undefined;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSort(raw: string | null): ServiceListFilters["sort"] {
  return raw === "newest" || raw === "price_asc" || raw === "price_desc" ? raw : undefined;
}

export async function GET(request: Request) {
  return withRequestTracing("api.v1.services.list", async () => {
    const locale = resolveApiLocale(request);
    const { searchParams } = new URL(request.url);
    const { page, pageSize } = parsePageParams(searchParams, SERVICES_DEFAULT_PAGE_SIZE);

    const filters: ServiceListFilters = {
      page,
      pageSize,
      search: searchParams.get("search") ?? undefined,
      providerId: searchParams.get("providerId") ?? undefined,
      categoryId: searchParams.get("categoryId") ?? undefined,
      regionCode: searchParams.get("regionCode") ?? undefined,
      minPrice: optionalNumber(searchParams.get("minPrice")),
      maxPrice: optionalNumber(searchParams.get("maxPrice")),
      sort: parseSort(searchParams.get("sort")),
    };

    const result = await getServices(filters, locale);

    return apiOk({
      items: result.items.map(toServiceSummaryDTO),
      page: result.page,
      pageSize: result.pageSize,
      totalCount: result.totalCount,
      totalPages: result.totalPages,
    });
  });
}
