import { getProviderBookingDetail } from "@/lib/provider/queries/get-provider-booking-detail";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderBookingDetailDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/provider/bookings/{id} — Gate PB. High sensitivity.
//
// getProviderBookingDetail() queries by BOTH the booking id AND the caller's own
// provider.id, returning null uniformly for invalid/missing/not-owned → 404. A
// provider can never read another provider's booking by guessing an id. No
// customer PII. Private/no-store.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.bookings.detail", () =>
    withApiV1Provider(request, async ({ locale }) => {
      const { id } = await params;
      const detail = await getProviderBookingDetail(id, locale);
      if (!detail) return apiError("NOT_FOUND", { locale });
      return apiOk(toProviderBookingDetailDTO(detail, locale));
    })
  );
}
