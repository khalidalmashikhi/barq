import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// Durable, distributed fixed-window rate limiter — P1 (auth/OTP hardening).
// Counters live in Postgres (the `auth_rate_limits` table), NOT process memory,
// so they are shared across every Vercel serverless instance and survive cold
// starts — closing the gap in the in-memory limiter (src/lib/rate-limit/
// rate-limiter.ts, booking/review only).
//
// ATOMIC, NO RACE: a single UPSERT either starts a fresh window (row absent or
// expired) or increments the current window's count, evaluated entirely inside
// the statement against the DB clock (now()). Concurrent requests for the same
// key serialize on that row's write lock — the same mechanism the booking
// oversell guard relies on — so two simultaneous requests can never both read a
// stale count and both pass. There is deliberately no separate SELECT.
//
// FAIL-CLOSED: any store error DENIES the request (allowed:false). An attacker
// cannot disable the limiter by inducing DB failures; and because this is the
// app's PRIMARY Postgres (the same DB Better Auth's OTP flow already needs to
// read/write the Verification table), a real outage fails the whole auth flow
// anyway, so failing closed here changes nothing an attacker could exploit. The
// error is logged WITHOUT any key/IP/phone/PII and never surfaced to the client.
//
// PRIVACY: `key` is always a namespaced, non-PII token (an HMAC of the IP, or the
// canonical +968 phone) chosen by the caller — this module never logs it.

export interface DurableRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Atomically consume one unit against `key`'s fixed window. Returns allowed:false
 * once more than `limit` requests occur within `windowSeconds`. Fail-closed on any
 * store error.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<DurableRateLimitResult> {
  try {
    const rows = await prisma.$queryRaw<Array<{ count: number | bigint; expiresAt: Date }>>(Prisma.sql`
      INSERT INTO "auth_rate_limits" ("key", "count", "windowStart", "expiresAt")
      VALUES (${key}, 1, now(), now() + (interval '1 second' * ${windowSeconds}))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "auth_rate_limits"."expiresAt" <= now() THEN 1
                       ELSE "auth_rate_limits"."count" + 1 END,
        "windowStart" = CASE WHEN "auth_rate_limits"."expiresAt" <= now() THEN now()
                             ELSE "auth_rate_limits"."windowStart" END,
        "expiresAt" = CASE WHEN "auth_rate_limits"."expiresAt" <= now()
                           THEN now() + (interval '1 second' * ${windowSeconds})
                           ELSE "auth_rate_limits"."expiresAt" END
      RETURNING "count", "expiresAt"
    `);

    const row = rows[0];
    if (!row) {
      // An UPSERT with RETURNING always yields a row; a missing one is an
      // unexpected internal condition — fail closed.
      logger.error("rateLimit.no_row_returned", {});
      return { allowed: false, retryAfterSeconds: windowSeconds };
    }

    const count = Number(row.count);
    if (count <= limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000));
    return { allowed: false, retryAfterSeconds };
  } catch (error) {
    // Fail closed; never leak store internals or any key/IP/phone.
    logger.error("rateLimit.store_error", { message: error instanceof Error ? error.message : "unknown error" });
    return { allowed: false, retryAfterSeconds: windowSeconds };
  }
}

/**
 * Best-effort bounded cleanup of long-expired rows so the table cannot grow
 * unbounded without a dedicated cron. Never affects a limiter decision — a
 * failure here is swallowed (logged, no PII). Called opportunistically.
 */
export async function sweepExpiredRateLimits(graceSeconds = 3600): Promise<void> {
  try {
    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM "auth_rate_limits" WHERE "expiresAt" < now() - (interval '1 second' * ${graceSeconds})
    `);
  } catch (error) {
    logger.warn("rateLimit.sweep_failed", { message: error instanceof Error ? error.message : "unknown error" });
  }
}
