import { getProviderServiceDetail } from "@/lib/provider/queries/get-provider-service-detail";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderServiceDetailDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/provider/services/{id} — Gate PB.
//
// getProviderServiceDetail() queries by BOTH the service id AND the caller's own
// provider.id, returning null uniformly for invalid/missing/not-owned → 404. A
// provider can never read another provider's service by guessing an id. Private.

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
