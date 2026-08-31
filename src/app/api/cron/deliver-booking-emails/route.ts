import { NextResponse } from "next/server";
import { deliverPendingBookingEmails } from "@/lib/notifications/email/deliver-booking-emails";
import { logger } from "@/lib/logger";
import { withRequestTracing } from "@/lib/observability/with-request-tracing";

// BOOKING NOTIFICATION DELIVERY — the transactional booking-email delivery cron. Mirrors
// expire-stale-bookings/route.ts EXACTLY: same CRON_SECRET bearer check (Vercel Cron sends
// `Authorization: Bearer ${CRON_SECRET}`; anything else is 401), same thin-wrapper convention (the
// worker in deliver-booking-emails.ts is independently unit-testable without this HTTP layer),
// same request tracing. The worker itself no-ops when booking email is disabled, so an unconfigured
// deployment's cron does nothing.

export async function GET(request: Request) {
  return withRequestTracing("cron.deliver_booking_emails", async () => {
    const authHeader = request.headers.get("authorization");

    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await deliverPendingBookingEmails();

    logger.info("cron.deliver_booking_emails_completed", {
      enabled: result.enabled,
      claimed: result.claimed,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
      retried: result.retried,
    });

    return NextResponse.json(result, { status: 200 });
  });
}
