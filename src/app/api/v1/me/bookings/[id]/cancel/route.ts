import { cancelBooking } from "@/lib/booking/cancel-booking";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";
import { bookingErrorResponse } from "@/lib/api/v1/booking-errors";

// POST /api/v1/me/bookings/{id}/cancel — Gate 3 (Booking Mutations).
//
// Thin adapter over the authoritative cancelBooking(), which: requires an
// authenticated Customer, re-verifies OWNERSHIP from the DB (a booking owned by
// another customer returns BOOKING_NOT_FOUND -> mapped to 404, so it is never
// enumerable), checks cancellation eligibility via the lifecycle transition
// matrix, and performs the CANCELLED transition + capacity release in one
// transaction. NO status write or capacity math is done here — the route never
// sets booking.status directly or bypasses the state machine.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.bookings.cancel", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const { id } = await params;

      const result = await cancelBooking(id);
      if (!result.ok) return bookingErrorResponse(result.error, locale);

      return apiOk({ ok: true });
    })
  );
}
