import { NextResponse } from "next/server";
import { runPrivateObjectCleanup } from "@/lib/storage/cleanup/private-object-cleanup";
import { purgeExpiredOnboardingRequests } from "@/lib/vehicles/onboarding/onboarding-request";
import { logger } from "@/lib/logger";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Phase 3C Slice 3B (durable-cleanup correction) — the private-object cleanup cron. Mirrors
// deliver-booking-emails/route.ts EXACTLY: same CRON_SECRET bearer check (Vercel Cron sends
// `Authorization: Bearer ${CRON_SECRET}`; anything else is 401), same thin-wrapper convention (the
// worker in private-object-cleanup.ts is independently unit/DB-testable without this HTTP layer),
// same request tracing. Internal only — there is NO customer/provider endpoint that triggers
// deletion or exposes the cleanup queue / object keys. The response body is unchanged (the object
// cleanup summary only).

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

    // Second, independent housekeeping step on the same schedule: a BOUNDED purge of onboarding
    // request records past their retention (never one that is being worked on). Isolated — its
    // failure is logged as a category only and never fails the object cleanup above.
    try {
      const purge = await purgeExpiredOnboardingRequests();
      logger.info("cron.purge_onboarding_requests_completed", { purged: purge.purged });
    } catch (error) {
      logger.error("cron.purge_onboarding_requests_failed", { error: error instanceof Error ? error.name : "NonError" });
    }

    return NextResponse.json(result, { status: 200 });
  });
}
