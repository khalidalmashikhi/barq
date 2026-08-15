import { getProviderServices } from "@/lib/provider/queries/get-provider-services";
import { getProviderServiceDetail } from "@/lib/provider/queries/get-provider-service-detail";
import { createService } from "@/lib/provider/create-service";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { serviceErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { readJsonObject, buildFormData, coerceField } from "@/lib/api/v1/request-body";
import { parsePageParams } from "@/lib/api/v1/pagination";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderServiceListItemDTO, toProviderServiceDetailDTO } from "@/lib/api/v1/dtos";
import type { ServiceStatus } from "@prisma/client";

// GET /api/v1/me/provider/services — Gate PB.
//
// Thin adapter over getProviderServices(), which scopes strictly to the caller's
// own provider.id (never accepts a providerId) and returns ALL statuses
// (DRAFT/PUBLISHED/PAUSED/ARCHIVED) — a provider manages their whole catalog.
// Shared pagination (default 12). Private/no-store.
//
// POST /api/v1/me/provider/services — Gate PC (Provider Mutation API).
//
// Thin adapter over createService(), which gates on requireApprovedProvider(),
// validates every field, and creates the DRAFT service together with its initial
// ACTIVE price in ONE transaction (priceAmount is the provider's only price write —
// price is otherwise append-only/versioned, and editing it is an explicitly un-made
// domain decision, so there is no separate provider price endpoint). On success it
// re-reads the new service and returns the same detail DTO as GET .../services/{id},
// with 201 Created.

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

export async function POST(request: Request) {
  return withRequestTracing("api.v1.me.provider.services.create", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const body = await readJsonObject(request);
      const formData = buildFormData({
        nameAr: coerceField(body.nameAr),
        nameEn: coerceField(body.nameEn),
        descriptionAr: coerceField(body.descriptionAr),
        descriptionEn: coerceField(body.descriptionEn),
        priceAmount: coerceField(body.priceAmount),
        categoryId: coerceField(body.categoryId),
        regionCode: coerceField(body.regionCode),
        pricingUnit: coerceField(body.pricingUnit),
      });

      const result = await createService(formData);
      if (!result.ok) return serviceErrorResponse(result.error, locale);

      const detail = await getProviderServiceDetail(result.serviceId, locale);
      // The service was just created and is owned by this provider, so the
      // ownership-scoped reader should always find it; a null here would be a
      // genuine internal inconsistency rather than a normal outcome.
      if (!detail) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toProviderServiceDetailDTO(detail), { status: 201 });
    })
  );
}
