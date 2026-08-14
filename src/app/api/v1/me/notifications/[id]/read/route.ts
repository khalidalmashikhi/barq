import { markNotificationRead } from "@/lib/notifications/mark-notification-read";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";
import { withApiV1Auth } from "@/lib/api/v1/auth";
import { apiOk } from "@/lib/api/v1/respond";
import { apiError } from "@/lib/api/v1/errors";

// POST /api/v1/me/notifications/{id}/read — Gate 3 (Notification Read).
//
// Thin adapter over the authoritative markNotificationRead(), which resolves the
// current user via requireAuth() and scopes the update by BOTH id AND userId
// (a notification owned by another user matches zero rows and is a silent no-op
// — never mutated, never revealed) and is idempotent (re-marking is a no-op).
// It returns { ok:false } only for a malformed id -> 400. Safe response only;
// the raw notification payload is never exposed.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestTracing("api.v1.me.notifications.read", () =>
    withApiV1Auth(request, async ({ locale }) => {
      const { id } = await params;

      const result = await markNotificationRead(id);
      if (!result.ok) return apiError("INVALID_INPUT", { locale });

      return apiOk({ ok: true });
    })
  );
}
