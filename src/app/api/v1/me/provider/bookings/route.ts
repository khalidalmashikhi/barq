import { getProviderBookings } from "@/lib/provider/queries/get-provider-bookings";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Provider } from "@/lib/api/v1/provider-auth";
import { parsePageParams } from "@/lib/api/v1/pagination";
import { apiOk } from "@/lib/api/v1/respond";
import { toProviderBookingListItemDTO } from "@/lib/api/v1/dtos";
import type { BookingStatus } from "@prisma/client";

// GET /api/v1/me/provider/bookings — Gate PB. High sensitivity.
//
// Thin adapter over getProviderBookings(), which scopes strictly to the caller's
// own provider.id (never accepts a providerId). The DTO carries NO customer PII
// (none exists in the schema). Optional filters the reader supports: status,
// serviceId, q. Shared pagination (default 10). Private/no-store.

export const dynamic = "force-dynamic";

const BOOKING_STATUSES: readonly BookingStatus[] = [
  "CREATED",
  "PENDING_PROVIDER",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
  "DISPUTED",
  "EXPIRED",
];

function parseBookingStatus(raw: string | null): BookingStatus | undefined {
  return raw && (BOOKING_STATUSES as readonly string[]).includes(raw) ? (raw as BookingStatus) : undefined;
}

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.provider.bookings.list", () =>
    withApiV1Provider(request, async ({ locale }) => {
      const searchParams = new URL(request.url).searchParams;
      const { page, pageSize } = parsePageParams(searchParams, 10);

      const result = await getProviderBookings(
        {
          page,
          pageSize,
          q: searchParams.get("q") ?? undefined,
          status: parseBookingStatus(searchParams.get("status")),
          serviceId: searchParams.get("serviceId") ?? undefined,
        },
        locale
      );

      return apiOk({
        items: result.items.map(toProviderBookingListItemDTO),
        page: result.page,
        pageSize: result.pageSize,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
      });
    })
  );
}
