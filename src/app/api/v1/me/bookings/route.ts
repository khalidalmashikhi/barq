import { getMyBookings, type GetMyBookingsParams } from "@/lib/booking/get-my-bookings";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { parsePageParams } from "@/lib/api/v1/pagination";
import { apiOk } from "@/lib/api/v1/respond";
import { toBookingSummaryDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/bookings — Gate 2 (Authenticated Customer Read).
//
// Thin adapter over the authoritative getMyBookings() reader, which resolves
// the current user via requireAuth() and scopes strictly to that user's own
// Customer.id (never another customer's bookings; honest empty list if the user
// has no Customer profile). Ordering, status semantics, and the price SNAPSHOT
// are the reader's — unchanged. Private/no-store.

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
