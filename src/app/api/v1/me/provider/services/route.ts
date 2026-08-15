import { getProviderServices } from "@/lib/provider/queries/get-provider-services";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { parsePageParams } from "@/lib/api/v1/pagination";
import { apiOk } from "@/lib/api/v1/respond";
import { toProviderServiceListItemDTO } from "@/lib/api/v1/dtos";
import type { ServiceStatus } from "@prisma/client";

// GET /api/v1/me/provider/services — Gate PB.
//
// Thin adapter over getProviderServices(), which scopes strictly to the caller's
// own provider.id (never accepts a providerId) and returns ALL statuses
// (DRAFT/PUBLISHED/PAUSED/ARCHIVED) — a provider manages their whole catalog.
// Shared pagination (default 12). Private/no-store.

export const dynamic = "force-dynamic";

const SERVICE_STATUSES: readonly ServiceStatus[] = ["DRAFT", "PUBLISHED", "PAUSED", "ARCHIVED"];

function parseServiceStatus(raw: string | null): ServiceStatus | undefined {
  return raw && (SERVICE_STATUSES as readonly string[]).includes(raw) ? (raw as ServiceStatus) : undefined;
}

function parseSort(raw: string | null): "newest" | "price_asc" | "price_desc" | undefined {
  return raw === "newest" || raw === "price_asc" || raw === "price_desc" ? raw : undefined;
}

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.provider.services.list", () =>
    withApiV1Provider(request, async ({ locale }) => {
      const searchParams = new URL(request.url).searchParams;
      const { page, pageSize } = parsePageParams(searchParams, 12);

      const result = await getProviderServices(
        {
          page,
          pageSize,
          q: searchParams.get("q") ?? undefined,
          status: parseServiceStatus(searchParams.get("status")),
          sort: parseSort(searchParams.get("sort")),
        },
        locale
      );

      return apiOk({
        items: result.items.map(toProviderServiceListItemDTO),
        page: result.page,
        pageSize: result.pageSize,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
      });
    })
  );
}
