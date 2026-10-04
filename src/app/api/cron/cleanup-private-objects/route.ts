import { NextResponse } from "next/server";
import { runPrivateObjectCleanup } from "@/lib/storage/cleanup/private-object-cleanup";
import { logger } from "@/lib/logger";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Phase 3C Slice 3B (durable-cleanup correction) — the private-object cleanup cron. Mirrors
// deliver-booking-emails/route.ts EXACTLY: same CRON_SECRET bearer check (Vercel Cron sends
// `Authorization: Bearer ${CRON_SECRET}`; anything else is 401), same thin-wrapper convention (the
// worker in private-object-cleanup.ts is independently unit/DB-testable without this HTTP layer),
// same request tracing. Internal only — there is NO customer/provider endpoint that triggers
// deletion or exposes the cleanup queue / object keys.

export async function GET(request: Request) {
  return withRequestTracing("cron.cleanup_private_objects", async () => {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await runPrivateObjectCleanup();

    logger.info("cron.cleanup_private_objects_completed", {
      claimed: result.claimed,
      completed: result.completed,
      retried: result.retried,
      failed: result.failed,
      skipped: result.skipped,
    });

    return NextResponse.json(result, { status: 200 });
  });
}
