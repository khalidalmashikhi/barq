import { NextResponse } from "next/server";
import { expireStaleBookings } from "@/lib/booking/expire-stale-bookings";
import { logger } from "@/lib/logger";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// Cron entry point — Phase 5.1 (Production Readiness). Triggered by
// Vercel Cron on the schedule in vercel.json (every 30 minutes).
// AUTHENTICATION: Vercel automatically sends `Authorization: Bearer
// ${CRON_SECRET}` on requests it generates for a configured cron job —
// this route rejects anything else with 401, so it can't be triggered
// by an arbitrary public request. A thin wrapper only: the actual
// expiry logic lives in expire-stale-bookings.ts, independently
// unit-testable without this HTTP layer (matches this codebase's
// existing contracts API routes' "route is a thin wrapper" convention).

export async function GET(request: Request) {
  return withRequestTracing("cron.expire_stale_bookings", async () => {
    const authHeader = request.headers.get("authorization");

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await expireStaleBookings();

    logger.info("cron.expire_stale_bookings_completed", {
      expiredCount: result.expiredCount,
      failedCount: result.failedCount,
    });

    return NextResponse.json(result, { status: 200 });
  });
}
