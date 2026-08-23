import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";

// BOOKING-CONFLICT-1A — the per-Vehicle serialization primitive that makes the
// "check-then-insert" reservation protocol race-safe WITHOUT a DB exclusion constraint
// (there is no CREATE EXTENSION / btree_gist precedent in this database).
//
// pg_advisory_xact_lock is TRANSACTION-scoped: it is acquired for the current
// transaction and released AUTOMATICALLY at COMMIT or ROLLBACK — never leaked, and never
// requiring a matching unlock call (unlike the session-scoped pg_advisory_lock, which we
// deliberately do NOT use). Concurrent transactions that lock the SAME vehicle key block
// one another, so the overlap check + insert that follow run under mutual exclusion for
// that vehicle; different vehicles hash to different keys and never contend.
//
// The 64-bit lock key is derived from the vehicle id via hashtextextended(text, 0) — a
// stable Postgres hash, so the same vehicle always maps to the same key. The id is passed
// as a bound parameter (Prisma tagged template), never string-interpolated.

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Acquire the transaction-scoped advisory lock for one vehicle. MUST be called inside an
 * interactive transaction (pass that tx) — a session-level call would leak the lock. Blocks
 * until the lock is granted; released automatically when the transaction ends.
 */
export async function acquireVehicleReservationLock(tx: DbClient, vehicleId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${vehicleId}::text, 0))`;
}
