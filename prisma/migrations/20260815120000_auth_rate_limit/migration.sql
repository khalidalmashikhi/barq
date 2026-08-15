-- Durable distributed auth/OTP rate limiting — P1 (security hardening). Purely
-- ADDITIVE and safe: ONE new table + ONE index. No change to any existing table
-- or column, no data rewrite/backfill, no drop/rename. NO Better Auth table is
-- touched — this is a dedicated BARQ table, never the `verifications` table. No
-- booking / pricing / payment / provider / auth-model / storage change.
--
-- The table stores ONLY a fixed-window counter per namespaced limiter key — always
-- an HMAC digest (of the client IP, or of the canonical +968 phone), never the
-- value itself — NEVER a raw IP, raw phone, OTP code, session, token, or any PII. Counters are incremented
-- atomically in a single UPSERT (src/lib/rate-limit/durable-rate-limiter.ts):
-- concurrent requests serialize on the row's write lock, so there is no
-- count-then-increment race and no oversell of the limit. Rows lazily reset when
-- their window expires (inside the same UPSERT) and long-expired rows are swept
-- opportunistically, so the table stays bounded without a dedicated cron.

-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "auth_rate_limits_expiresAt_idx" ON "auth_rate_limits"("expiresAt");
