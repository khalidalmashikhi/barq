import "server-only";
import type { DbClient } from "./reservation-types";

// Phase 3C Slice C3/E1 — the idempotent, BOUNDED primitive that transitions stale temporary holds to
// EXPIRED. A HELD row whose server-owned expiresAt has passed no longer blocks its vehicle/day (the
// conflict reader already ignores it), but it must be moved OFF the active partial-unique index so the
// day can be re-acquired; that transition happens HERE (or inline inside acquisition for the exact
// targeted keys) — NEVER via a DB NOW()-based index predicate. It touches ONLY stale HELD rows; it
// NEVER touches CONFIRMED (which never auto-expires), RELEASED, EXPIRED, or CANCELLED. No cron/
// scheduler is introduced in this slice; this is the reusable primitive a future scheduler would call.

/** Default per-batch ceiling for the general cleanup sweep (kept small + explicitly bounded). */
export const EXPIRE_STALE_HOLDS_DEFAULT_LIMIT = 500;
const EXPIRE_STALE_HOLDS_MAX_LIMIT = 2000;

/**
 * Transition up to `limit` stale HELD rows (expiresAt <= now) to EXPIRED. Two-step (select bounded
 * ids, then a guarded updateMany) because Prisma cannot LIMIT an updateMany; the second step re-checks
 * status + expiry so a concurrent transition can never double-apply. Returns the number expired.
 */
export async function expireStaleDailyRentalHolds(
  db: DbClient,
  params?: { now?: Date; limit?: number },
): Promise<{ expired: number }> {
  const now = params?.now ?? new Date();
  const limit = Math.max(1, Math.min(params?.limit ?? EXPIRE_STALE_HOLDS_DEFAULT_LIMIT, EXPIRE_STALE_HOLDS_MAX_LIMIT));

  const stale = (await db.rentalVehicleDayReservation.findMany({
    where: { status: "HELD", expiresAt: { lte: now } },
    select: { id: true },
    take: limit,
  })) as unknown as { id: string }[];
  if (stale.length === 0) return { expired: 0 };

  const updated = await db.rentalVehicleDayReservation.updateMany({
    where: { id: { in: stale.map((s) => s.id) }, status: "HELD", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  return { expired: updated.count };
}

/**
 * Targeted variant used INSIDE acquisition: expire stale HELD rows for exactly one vehicle + a bounded
 * set of Oman `@db.Date` values, inside the caller's transaction. Never touches CONFIRMED. Provided so
 * acquisition and any caller share one expiry rule.
 */
export async function expireStaleHoldsForVehicleDates(
  tx: DbClient,
  vehicleId: string,
  serviceDates: Date[],
  now: Date,
): Promise<{ expired: number }> {
  if (serviceDates.length === 0) return { expired: 0 };
  const updated = await tx.rentalVehicleDayReservation.updateMany({
    where: { vehicleId, serviceDate: { in: serviceDates }, status: "HELD", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  return { expired: updated.count };
}
