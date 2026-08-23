import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

// BOOKING-CONFLICT-1A — the ONE primitive that lifts a vehicle's hold when its booking is
// cancelled / no-showed / reassigned (wired by a later gate). It RELEASES rather than
// DELETES: setting releasedAt preserves the reservation as history and frees the window for
// the overlap check (which ignores releasedAt IS NOT NULL rows) in a single, auditable step.
//
// Idempotent: it only touches rows still active (releasedAt IS NULL), so a second call — or
// a call for a booking that never had / already released its reservation — is a harmless
// no-op returning { released: 0 }. Never deletes; never touches booking status or payment.

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Release the active reservation (if any) held for a booking, stamping releasedAt. Safe to
 * call inside or outside a transaction and safe to call repeatedly. Returns how many active
 * reservations were released (0 or 1 in practice, since bookingId is unique).
 */
export async function releaseVehicleReservationForBooking(
  tx: DbClient,
  bookingId: string,
  releasedAt: Date,
): Promise<{ released: number }> {
  const result = await tx.vehicleReservation.updateMany({
    where: { bookingId, releasedAt: null },
    data: { releasedAt },
  });
  return { released: result.count };
}
