import { getProviderBookingDetail } from "@/lib/provider/queries/get-provider-booking-detail";
import { completeBooking } from "@/lib/booking/complete-booking";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { providerBookingErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderBookingDetailDTO } from "@/lib/api/v1/dtos";

// POST /api/v1/me/provider/bookings/{id}/complete — Gate PC (Provider Mutation API).
//
// Thin adapter over completeBooking(), which gates on requireProvider(), re-checks
// ownership (uniform BOOKING_NOT_FOUND → 404), enforces the completable precondition
// (BOOKING_NOT_ACTIONABLE → 409), and runs the completion engine (Invoice creation).
// On success it re-reads the booking and returns the same detail DTO as GET
// .../bookings/{id}. Private/no-store.

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.bookings.complete", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id } = await params;
      const result = await completeBooking(id);
      if (!result.ok) return providerBookingErrorResponse(result.error, locale);

      const detail = await getProviderBookingDetail(id, locale);
      if (!detail) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toProviderBookingDetailDTO(detail, locale));
    })
  );
}
