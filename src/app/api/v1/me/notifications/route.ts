import { getNotifications } from "@/lib/notifications/get-notifications";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { parsePageParams } from "@/lib/api/v1/pagination";
import { apiOk } from "@/lib/api/v1/respond";
import { toNotificationDTO } from "@/lib/api/v1/dtos";

// GET /api/v1/me/notifications — Gate 2 (Authenticated Customer Read).
//
// Thin adapter over the authoritative getNotifications() reader, which resolves
// the current user via requireAuth() and scopes strictly to that user's own
// userId. The DTO exposes only the localized `message` (extracted from the
// notification content) + safe fields — never the raw content JSON payload.
// Read/unread state (readAt → isRead) is preserved. Private/no-store.

export const dynamic = "force-dynamic";

const NOTIFICATIONS_DEFAULT_PAGE_SIZE = 20;

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.notifications.list", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const { searchParams } = new URL(request.url);
      const { page, pageSize } = parsePageParams(searchParams, NOTIFICATIONS_DEFAULT_PAGE_SIZE);

      const result = await getNotifications({ page, pageSize }, locale);

      return apiOk({
        items: result.items.map(toNotificationDTO),
        page: result.page,
        pageSize: result.pageSize,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
      });
    })
  );
}
