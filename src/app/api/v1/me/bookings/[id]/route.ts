import { getBookingDetail } from "@/lib/booking/get-booking-detail";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { toBookingDetailDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/bookings/{id} — Gate 2 (Authenticated Customer Read).
//
// SECURITY: getBookingDetail() enforces ownership at the query boundary
// (findFirst where customerId === the authenticated user's Customer.id) and
// returns null identically for "not found", "not yours", and "invalid id" — the
// existing uniform-404 anti-enumeration convention. User A can never retrieve
// User B's booking, nor learn whether it exists. Private/no-store.

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.bookings.detail", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const { id } = await params;

      const detail = await getBookingDetail(id, locale);
      if (!detail) return apiError("NOT_FOUND", { locale });

      return apiOk(toBookingDetailDTO(detail));
    })
  );
}
