import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { transitionBooking, dispatchLifecycleHook } from "@/lib/booking/lifecycle";
import { cancelConfirmedDailyRentalReservations } from "@/lib/offerings/rental/reservation/cancel-confirmed-daily-rental-reservations";
import { isRentalBookingSnapshot } from "@/lib/booking/rental-booking-summary";
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

  // A PENDING_PROVIDER booking is stale when EITHER (slot) its Availability slot has already started,
  // OR (Phase 3C Slice C3/E2 — rental) it is a rental booking whose server-owned provider-response
  // deadline has passed. The rental arm is FAIL-CLOSED in TWO stages. Stage 1 (this query): a booking
  // qualifies for the rental arm only when `rentalSnapshot` is a real, non-null JSON value — NOT SQL
  // NULL and NOT the JSON literal `null`. `rentalSnapshot` is a nullable Json column, so `Prisma.AnyNull`
  // is the value that excludes BOTH null representations (`Prisma.DbNull` alone would still match a JSON
  // `null` literal; `Prisma.JsonNull` alone would still match SQL NULL). This prevents a stray/imported/
  // manually-repaired `providerResponseDeadlineAt` on a non-rental booking (SQL NULL or JSON-null
  // snapshot) from being swept by this branch — the deadline alone is not sufficient. Stage 2 is the
  // runtime `isRentalBookingSnapshot` guard below: `AnyNull` cannot exclude a non-null-yet-malformed
  // JSON value (e.g. `{}`, an array, a primitive), so the guard rejects those before any transition or
  // release. Booking identity (rental vs slot) is decided by the snapshot, never by the deadline.
  const staleBookings = await prisma.booking.findMany({
    where: {
      status: "PENDING_PROVIDER",
      OR: [
        { availability: { startTime: { lte: now } } },
        { rentalSnapshot: { not: Prisma.AnyNull }, providerResponseDeadlineAt: { lte: now } },
      ],
    },
    select: { id: true, availabilityId: true, seats: true, rentalSnapshot: true, providerResponseDeadlineAt: true },
  });

  let expiredCount = 0;
  let failedCount = 0;

  for (const booking of staleBookings) {
    // Rental identity is the SNAPSHOT, not the deadline: classification uses the fail-closed structural
    // guard, so a non-rental booking with a stray deadline matched only by the slot arm is still
    // treated as a slot booking (fires the hook, rental release is an idempotent no-op).
    const isRental = isRentalBookingSnapshot(booking.rentalSnapshot);

    // Stage-2 fail-closed skip: a booking that is NOT a valid rental and has NO slot could only have
    // reached this list via the rental arm on a non-null-yet-malformed snapshot ({} / array / primitive
    // that `not: AnyNull` cannot exclude). Skip it entirely — no status change, no release — and log
    // ONLY its id (never snapshot content). Malformed rows are neither expired nor counted as failures.
    if (!isRental && booking.availabilityId === null) {
      logger.warn("expireStaleBookings.skipped_malformed_rental_candidate", { bookingId: booking.id });
      continue;
    }

    try {
      const hookContext = await prisma.$transaction(async (tx) => {
        const ctx = await transitionBooking(
          { bookingId: booking.id, toStatus: "EXPIRED", actorType: "SYSTEM" },
          tx
        );

        if (!isRental && booking.availabilityId) {
          await tx.$executeRaw`
            UPDATE availabilities
            SET "bookedCount" = GREATEST("bookedCount" - ${booking.seats}, 0)
            WHERE id = ${booking.availabilityId}::uuid
          `;
        }

        // Phase 3C Slice C3/E2 — release a rental booking's daily inventory in the SAME transaction:
        // its CONFIRMED daily children → CANCELLED. Idempotent no-op for a non-rental booking.
        await cancelConfirmedDailyRentalReservations(tx, booking.id, now);

        return ctx;
      });

      // Existing slot-booking expiry fires the lifecycle hook (customer notification). Rental-booking
      // notification is out of this slice's scope (mirrors the confirm authority's no-hook stance) —
      // the EXPIRED booking is visible in the customer's surfaces; wiring the notification is deferred.
      if (!isRental) await dispatchLifecycleHook(hookContext);
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
