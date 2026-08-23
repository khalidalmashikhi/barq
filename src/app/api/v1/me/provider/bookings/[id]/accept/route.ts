import { getProviderBookingDetail } from "@/lib/provider/queries/get-provider-booking-detail";
import { acceptBooking } from "@/lib/booking/accept-booking";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1ProviderMutation } from "@/lib/api/v1/provider-mutation-auth";
import { providerBookingErrorResponse } from "@/lib/api/v1/provider-mutation-errors";
import { readJsonObject, coerceField } from "@/lib/api/v1/request-body";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toProviderBookingDetailDTO } from "@/lib/api/v1/dtos";

// POST /api/v1/me/provider/bookings/{id}/accept — Gate PC (Provider Mutation API),
// extended in BOOKING-VEHICLE-1 with the provider's vehicle selection.
//
// Thin adapter over acceptBooking(), which gates on requireProvider(), re-checks
// ownership (booking.providerId === caller's provider.id → uniform BOOKING_NOT_FOUND
// → 404 for missing/not-owned), enforces the PENDING_PROVIDER precondition
// (BOOKING_NOT_ACTIONABLE → 409), and runs the full accept engine (payment initiation
// + commission snapshot). An OPTIONAL `vehicleId` in the body carries the provider's
// chosen vehicle — REQUIRED by acceptBooking for transport tour packages, ignored for
// GUIDE_ONLY / non-tour. The vehicle is validated server-side against the service pool +
// live eligibility (never trusted). On success it re-reads the booking via the
// ownership-scoped reader and returns the same detail DTO as GET .../bookings/{id}.
// Private/no-store.

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.provider.bookings.accept", () =>
    withApiV1ProviderMutation(request, async ({ locale }) => {
      const { id } = await params;
      const body = await readJsonObject(request);
      const vehicleId = coerceField(body.vehicleId);
      // BOOKING-INTERVAL-1 — optional ISO-8601 operational schedule (slotless vehicle-required
      // bookings only; ignored otherwise). Parsed to instants here; acceptBooking validates.
      const startRaw = coerceField(body.operationalStartAt);
      const endRaw = coerceField(body.operationalEndAt);
      const operationalStartAt = startRaw ? new Date(startRaw) : null;
      const operationalEndAt = endRaw ? new Date(endRaw) : null;

      const result = await acceptBooking(id, vehicleId, operationalStartAt, operationalEndAt);
      if (!result.ok) return providerBookingErrorResponse(result.error, locale);

      const detail = await getProviderBookingDetail(id, locale);
      if (!detail) return apiError("INTERNAL_ERROR", { locale });
      return apiOk(toProviderBookingDetailDTO(detail));
    })
  );
}
