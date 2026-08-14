import { getUnreadCount } from "@/lib/notifications/get-unread-count";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";

// GET /api/v1/me/notifications/unread-count — Gate 2 (Authenticated Customer Read).
//
// Reuses the existing authoritative getUnreadCount() — a single indexed COUNT
// (WHERE userId = ? AND readAt IS NULL) scoped to the authenticated user. Trivial
// and clearly useful for a native app badge; no new architecture. Private/no-store.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withRequestTracing("api.v1.me.notifications.unread_count", () =>
    withApiV1Auth(request, async () => {
      const unreadCount = await getUnreadCount();
      return apiOk({ unreadCount });
    })
  );
}
