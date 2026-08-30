import { getMyBookings, type GetMyBookingsParams } from "@/lib/booking/get-my-bookings";
import { createBooking } from "@/lib/booking/create-booking";
import { getBookingDetail } from "@/lib/booking/get-booking-detail";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { parsePageParams } from "@/lib/api/v1/pagination";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";
import { bookingErrorResponse } from "@/lib/api/v1/booking-errors";
import { toBookingSummaryDTO, toBookingDetailDTO } from "@/lib/api/v1/dtos";

// GET  /api/v1/me/bookings — Gate 2 (list, authoritative getMyBookings()).
// POST /api/v1/me/bookings — Gate 3 (create, authoritative createBooking()).
//
// Both are thin adapters over the authoritative booking domain, which resolves
// the current user via requireAuth()/requireCustomer() and scopes strictly to
// that user's own Customer. NO booking business logic (validation, price
// snapshot, capacity reservation, status transition) is reimplemented here.
// Private/no-store.

export const dynamic = "force-dynamic";

const BOOKINGS_DEFAULT_PAGE_SIZE = 10;

function parseWhen(raw: string | null): GetMyBookingsParams["when"] {
  return raw === "upcoming" || raw === "past" ? raw : undefined;
}

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.bookings.list", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const { searchParams } = new URL(request.url);
      const { page, pageSize } = parsePageParams(searchParams, BOOKINGS_DEFAULT_PAGE_SIZE);

      const result = await getMyBookings(
        {
          page,
          pageSize,
          when: parseWhen(searchParams.get("when")),
          search: searchParams.get("search") ?? undefined,
        },
        locale
      );

      return apiOk({
        items: result.items.map(toBookingSummaryDTO),
        page: result.page,
        pageSize: result.pageSize,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
      });
    })
  );
}

// POST /api/v1/me/bookings — create a booking.
//
// The client submits ONLY selections { serviceId, priceId, availabilityId?,
// seats? }. Everything authoritative — customer identity, service PUBLISHED +
// provider APPROVED/visible, ACTIVE price + server-side price snapshot, slot
// validity, atomic capacity reservation, initial status transition, and the
// per-customer rate limit — is re-derived inside createBooking(); nothing here
// trusts a client-supplied price/currency/provider/status/capacity. On success
// the just-created booking is re-read via the ownership-scoped getBookingDetail()
// and returned as BookingDetailDTO (201).
export async function POST(request: Request) {
  return withRequestTracing("api.v1.me.bookings.create", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return apiError("INVALID_INPUT", { locale });

      // Build the exact FormData shape createBooking() already consumes on the
      // web — an input-adapter only, NOT a reimplementation. createBooking()
      // re-validates every field (uuids, positive seats) and ignores anything
      // else, so only these four selection keys are forwarded.
      const form = new FormData();
      form.set("serviceId", typeof body.serviceId === "string" ? body.serviceId : "");
      form.set("priceId", typeof body.priceId === "string" ? body.priceId : "");
      if (typeof body.availabilityId === "string" && body.availabilityId.length > 0) {
        form.set("availabilityId", body.availabilityId);
      }
      if (body.seats !== undefined && body.seats !== null) {
        form.set("seats", String(body.seats));
      }

      // BOOKING-IDEMPOTENCY — the standard `Idempotency-Key` request header (falling back to a
      // body field for clients that cannot set it), forwarded into the SAME domain seam the web
      // form uses. createBooking() validates it, arbitrates the race at the DB, and replays the
      // original booking on a same-key same-request retry. Absent header = today's behavior.
      const idempotencyKey =
        request.headers.get("Idempotency-Key") ??
        (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null);
      if (idempotencyKey !== null) {
        form.set("idempotencyKey", idempotencyKey);
      }

      const result = await createBooking(form);
      if (!result.ok) return bookingErrorResponse(result.error, locale);

      const detail = await getBookingDetail(result.bookingId, locale);
      if (!detail) return apiError("INTERNAL_ERROR", { locale });

      return apiOk({ booking: toBookingDetailDTO(detail, locale) }, { status: 201 });
    })
  );
}
