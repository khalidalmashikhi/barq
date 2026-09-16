import "server-only";
import { dbDateFromOmanDateKey, omanDateKeyFromDbDate } from "@/lib/date/oman-time";
import type { DbClient } from "./reservation-types";

// Phase 3C Slice C3/E1 — the READ-ONLY, bounded daily-rental vehicle/day conflict reader. Given a
// bounded set of physical vehicle ids and an Oman date window, it returns the set of (vehicle, day)
// pairs that are currently BLOCKED by an ACTIVE reservation:
//   • every CONFIRMED row, and
//   • every HELD row whose server-owned expiry is still in the future (an expired HELD does NOT
//     block, even if it has not yet been transitioned to EXPIRED).
// RELEASED / EXPIRED / CANCELLED rows are ignored. It NEVER mutates, accepts a supplied db client,
// runs ONE bounded query (no N+1), and returns only normalized vehicle/date keys — never a customer
// id, booking id, hold token, expiry, price, or any reservation metadata. A physical vehicle/day is
// BINARY (held or not): seats are never treated as remaining inventory.

/** The conflict-key form the calendar resolver matches against: `${vehicleId}|${omanDateKey}`. */
export function rentalConflictKey(vehicleId: string, dateKey: string): string {
  return `${vehicleId}|${dateKey}`;
}

/**
 * Read the active daily-rental conflicts for `vehicleIds` over the inclusive Oman window [from, to].
 * Returns a Set of `${vehicleId}|${dateKey}` keys. Empty input (no vehicles or invalid window) →
 * empty set (no query). `now` is injectable for deterministic tests.
 */
export async function getDailyRentalVehicleConflicts(
  vehicleIds: string[],
  window: { from: string; to: string },
  db: DbClient,
  now: Date = new Date(),
): Promise<Set<string>> {
  const conflicts = new Set<string>();
  if (vehicleIds.length === 0) return conflicts;

  const dbFrom = dbDateFromOmanDateKey(window.from);
  const dbTo = dbDateFromOmanDateKey(window.to);
  if (dbFrom === null || dbTo === null || dbFrom > dbTo) return conflicts;

  // De-duplicate the vehicle id set so the IN bound reflects distinct vehicles only.
  const ids = [...new Set(vehicleIds)];

  const rows = (await db.rentalVehicleDayReservation.findMany({
    where: {
      vehicleId: { in: ids },
      serviceDate: { gte: dbFrom, lte: dbTo },
      // ACTIVE + blocking only: CONFIRMED (indefinite) or a HELD that has NOT yet lapsed.
      OR: [{ status: "CONFIRMED" }, { status: "HELD", expiresAt: { gt: now } }],
    },
    select: { vehicleId: true, serviceDate: true },
  })) as unknown as { vehicleId: string; serviceDate: Date }[];

  for (const r of rows) conflicts.add(rentalConflictKey(r.vehicleId, omanDateKeyFromDbDate(r.serviceDate)));
  return conflicts;
}
