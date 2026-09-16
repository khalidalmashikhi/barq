import "server-only";
import type { DbClient } from "./reservation-types";

// Phase 3C Slice C3/E2 — the shared, server-only primitive that releases a rental Booking's daily
// inventory when the Booking is cancelled/rejected/expired. It transitions every CONFIRMED child
// reservation linked (via its hold group's bookingId) to that Booking → CANCELLED (a non-blocking
// terminal state), so the vehicle/day frees up. MUST be called INSIDE the same transaction as the
// Booking status change so the two commit/roll back together.
//
// Scoped strictly to the given booking's hold group(s); idempotent (0 rows for a non-rental booking,
// or when already cancelled); never touches HELD rows (an unconfirmed hold has no bookingId link),
// another booking's rows, legacy VehicleReservation, or guided tables. Historical price/date
// snapshots are preserved (status flip only — never a delete). A two-step scalar-filter form is used
// because Prisma updateMany cannot filter by a relation.

export async function cancelConfirmedDailyRentalReservations(
  tx: DbClient,
  bookingId: string,
  now: Date = new Date(),
): Promise<{ cancelled: number }> {
  const groups = (await tx.rentalVehicleDayHoldGroup.findMany({
    where: { bookingId },
    select: { id: true },
  })) as unknown as { id: string }[];
  if (groups.length === 0) return { cancelled: 0 };

  const updated = await tx.rentalVehicleDayReservation.updateMany({
    where: { holdGroupId: { in: groups.map((g) => g.id) }, status: "CONFIRMED" },
    data: { status: "CANCELLED", releasedAt: now },
  });
  return { cancelled: updated.count };
}
