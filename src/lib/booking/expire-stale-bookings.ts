import "server-only";
import { prisma } from "@/lib/db";
import { transitionBooking, dispatchLifecycleHook } from "@/lib/booking/lifecycle";
import { logger } from "@/lib/logger";

// Automatic expiry for stale bookings — Phase 5.1 (Production
// Readiness). A PENDING_PROVIDER booking whose linked Availability slot
// has already started with no provider response is expired — this is
// the exact gap the audit flagged ("a provider can accept/start a
// booking whose slot's startTime is already in the past"), not an
// arbitrary time-since-created cutoff.
//
// Bookings with no linked Availability (availabilityId is nullable —
// only possible if a slot was deleted while a booking was still
// pending) are NOT targeted by this query; a known, accepted
// limitation, not solved here.
//
// Each booking gets its OWN transaction (mirrors reject-booking.ts's
// per-booking transaction, not one shared transaction across all rows)
// so one row's failure can never roll back another's already-committed
// expiry. The lifecycle hook fires only after each transaction commits
// — same rule as every existing status-changing action.
//
// Invoked by src/app/api/cron/expire-stale-bookings/route.ts on a
// schedule (see vercel.json); kept as a plain lib function, independent
// of the HTTP layer, so it's directly unit-testable without a request.

export interface ExpireStaleBookingsResult {
  expiredCount: number;
  failedCount: number;
}

export async function expireStaleBookings(): Promise<ExpireStaleBookingsResult> {
  const now = new Date();

  const staleBookings = await prisma.booking.findMany({
    where: {
      status: "PENDING_PROVIDER",
      availability: { startTime: { lte: now } },
    },
    select: { id: true, availabilityId: true, seats: true },
  });

  let expiredCount = 0;
  let failedCount = 0;

  for (const booking of staleBookings) {
    try {
      const hookContext = await prisma.$transaction(async (tx) => {
        const ctx = await transitionBooking(
          { bookingId: booking.id, toStatus: "EXPIRED", actorType: "SYSTEM" },
          tx
        );

        if (booking.availabilityId) {
          await tx.$executeRaw`
            UPDATE availabilities
            SET "bookedCount" = GREATEST("bookedCount" - ${booking.seats}, 0)
            WHERE id = ${booking.availabilityId}::uuid
          `;
        }

        return ctx;
      });

      await dispatchLifecycleHook(hookContext);
      expiredCount += 1;
    } catch (error) {
      failedCount += 1;
      logger.error("expireStaleBookings.booking_failed", {
        bookingId: booking.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { expiredCount, failedCount };
}
