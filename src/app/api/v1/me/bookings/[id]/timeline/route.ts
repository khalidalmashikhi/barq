import { getBookingDetail } from "@/lib/booking/get-booking-detail";
import { getBookingTimeline } from "@/lib/booking/lifecycle";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toBookingTimelineEventDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/bookings/{id}/timeline — Gate 3 (Booking Mutations).
//
// OWNERSHIP + ANTI-ENUMERATION: the booking is first resolved through the
// ownership-scoped getBookingDetail() (customerId === the caller's Customer),
// which returns null identically for not-found / not-owned / invalid id -> 404,
// so a customer can never read another customer's timeline or learn one exists.
// Timeline data comes from the existing getBookingTimeline(), whose DTO is
// ALREADY actorId-free (never exposes internal Customer/Provider/User ids).
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.bookings.timeline", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const { id } = await params;

      const detail = await getBookingDetail(id, locale);
      if (!detail) return apiError("NOT_FOUND", { locale });

      const timeline = await getBookingTimeline(detail.id);
      return apiOk({ items: timeline.map(toBookingTimelineEventDTO) });
    })
  );
}
