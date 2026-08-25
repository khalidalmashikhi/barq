import { getProviderBookingDetail } from "@/lib/provider/queries/get-provider-booking-detail";
import { rejectBooking } from "@/lib/booking/reject-booking";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { providerBookingErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { readJsonObject, coerceField } from "@/lib/api/v1/request-body";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderBookingDetailDTO } from "@/lib/api/v1/dtos";

// POST /api/v1/me/provider/bookings/{id}/reject — Gate PC (Provider Mutation API).
//
// Thin adapter over rejectBooking(), which gates on requireProvider(), re-checks
// ownership (uniform BOOKING_NOT_FOUND → 404), enforces the PENDING_PROVIDER
// precondition (BOOKING_NOT_ACTIONABLE → 409), and atomically releases the held
// capacity. An optional `reason` string is passed through verbatim. On success it
// re-reads the booking and returns the same detail DTO as GET .../bookings/{id}.

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.bookings.reject", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id } = await params;
      const body = await readJsonObject(request);
      const reason = coerceField(body.reason);

      const result = await rejectBooking(id, reason);
      if (!result.ok) return providerBookingErrorResponse(result.error, locale);

      const detail = await getProviderBookingDetail(id, locale);
      if (!detail) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toProviderBookingDetailDTO(detail, locale));
    })
  );
}
