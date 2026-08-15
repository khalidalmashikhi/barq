import { getProviderServiceDetail } from "@/lib/provider/queries/get-provider-service-detail";
import { unpublishService } from "@/lib/provider/transition-service-status";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { serviceErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderServiceDetailDTO } from "@/lib/api/v1/dtos";

// POST /api/v1/me/provider/services/{id}/unpublish — Gate PC (Provider Mutation API).
//
// Thin adapter over unpublishService() (PUBLISHED → PAUSED), which re-checks
// ownership (uniform SERVICE_NOT_FOUND → 404) and enforces the status graph
// (INVALID_STATUS_TRANSITION → 409). On success it re-reads and returns the same
// detail DTO as GET .../services/{id}.

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.services.unpublish", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id } = await params;
      const result = await unpublishService(id);
      if (!result.ok) return serviceErrorResponse(result.error, locale);

      const detail = await getProviderServiceDetail(id, locale);
      if (!detail) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toProviderServiceDetailDTO(detail));
    })
  );
}
