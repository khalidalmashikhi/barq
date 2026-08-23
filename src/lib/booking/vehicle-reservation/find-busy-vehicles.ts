import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";

// BOOKING-CONFLICT-1C — the READ-ONLY, batch busy-state lookup that powers the provider's
// proactive "this vehicle is already taken" UX on the acceptance screen. Given a set of
// candidate vehicle ids and a booking's operational window, it returns the subset that
// currently hold an ACTIVE reservation overlapping that window.
//
// IMPORTANT (see gate §4): this is UX ONLY — it is NOT the race authority. Even when this
// says a vehicle is free, acceptBooking still takes the per-vehicle pg_advisory_xact_lock,
// re-runs the overlap check, and inserts inside the transaction (BOOKING-CONFLICT-1B). So it
// deliberately takes NO advisory lock and may be momentarily stale; the final guarantee is
// unchanged. The overlap predicate is the SAME half-open math as reserveVehicleForBooking and
// reservationIntervalsOverlap (existing.startsAt < end AND existing.endsAt > start), so the
// proactive hint and the authoritative check never disagree on the semantics.
//
// ONE bounded query for ALL candidates (vehicleId IN (...)) — never one query per vehicle.

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * The subset of `vehicleIds` that have at least one ACTIVE (releasedAt IS NULL) reservation
 * whose window overlaps the half-open interval [startsAt, endsAt). Empty input → empty set
 * (no query). Read-only; safe to call outside a transaction.
 */
export async function findBusyVehicleIdsForInterval(
  db: DbClient,
  vehicleIds: string[],
  startsAt: Date,
  endsAt: Date,
): Promise<Set<string>> {
  if (vehicleIds.length === 0) return new Set();

  const rows = await db.$queryRaw<Array<{ vehicleId: string }>>(Prisma.sql`
    SELECT DISTINCT "vehicleId"
    FROM "vehicle_reservations"
    WHERE "vehicleId" IN (${Prisma.join(vehicleIds.map((id) => Prisma.sql`${id}::uuid`))})
      AND "releasedAt" IS NULL
      AND "startsAt" < ${endsAt}::timestamptz
      AND "endsAt" > ${startsAt}::timestamptz
  `);

  return new Set(rows.map((r) => r.vehicleId));
}
