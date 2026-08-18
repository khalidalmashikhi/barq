import { getProviderServiceDetail } from "@/lib/provider/queries/get-provider-service-detail";
import { updateService } from "@/lib/provider/update-service";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { serviceErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { readJsonObject, buildFormData, coerceField, serializeGuidingContentField } from "@/lib/api/v1/request-body";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderServiceDetailDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/provider/services/{id} — Gate PB.
//
// getProviderServiceDetail() queries by BOTH the service id AND the caller's own
// provider.id, returning null uniformly for invalid/missing/not-owned → 404. A
// provider can never read another provider's service by guessing an id. Private.
//
// PATCH /api/v1/me/provider/services/{id} — Gate PC (Provider Mutation API).
//
// Thin adapter over updateService(), which re-checks ownership (service.providerId
// === caller's provider.id → uniform SERVICE_NOT_FOUND → 404 otherwise) and only
// mutates name/description/category/region/pricingUnit — status changes go through
// the dedicated publish/unpublish routes, and price stays append-only (unchanged
// here). regionCode/pricingUnit follow the domain's absent-vs-empty semantics,
// which the JSON→FormData adapter preserves: omit a field to leave it unchanged,
// send "" to clear it. On success it re-reads and returns the same detail DTO.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.services.detail", () =>
    withApiV1Provider(request, async ({ locale }) => {
      const { id } = await params;
      const detail = await getProviderServiceDetail(id, locale);
      if (!detail) return apiError("NOT_FOUND", { locale });
      return apiOk(toProviderServiceDetailDTO(detail));
    })
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.services.update", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id } = await params;
      const body = await readJsonObject(request);
      const formData = buildFormData({
        nameAr: coerceField(body.nameAr),
        nameEn: coerceField(body.nameEn),
        descriptionAr: coerceField(body.descriptionAr),
        descriptionEn: coerceField(body.descriptionEn),
        categoryId: coerceField(body.categoryId),
        regionCode: coerceField(body.regionCode),
        pricingUnit: coerceField(body.pricingUnit),
        // TOUR-1 — serialized to the domain's single parseGuidingContent() path;
        // absent = leave unchanged (except on a transition away from eligibility,
        // which the domain action clears atomically).
        guidingContent: serializeGuidingContentField(body.guidingContent),
      });

      const result = await updateService(id, formData);
      if (!result.ok) return serviceErrorResponse(result.error, locale);

      const detail = await getProviderServiceDetail(id, locale);
      if (!detail) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toProviderServiceDetailDTO(detail));
    })
  );
}
