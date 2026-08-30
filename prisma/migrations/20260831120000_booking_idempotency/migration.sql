-- BOOKING-IDEMPOTENCY — the durable, database-backed record that makes booking CREATION
-- idempotent under double-click / browser / network / API / native / concurrent retries.
--
-- ADDITIVE / LEGACY-SAFE ONLY. One brand-new table; no existing row, column, enum, index, or
-- constraint is touched. No backfill (existing bookings get NO idempotency row — nothing is
-- replayable by key for them, which is correct: they were created before this mechanism).
--   * id is app-generated (uuid v7, ADR-0006) — no DB default, matching every other model.
--   * bookingId is UNIQUE — at most one idempotency claim per booking.
--   * (customerId, idempotencyKey) is UNIQUE — THE race arbiter. Two concurrent requests with
--     the same authenticated customer + key cannot both commit: Postgres serializes the inserts,
--     the loser gets a unique violation and its whole transaction (booking + capacity mutation)
--     rolls back, so a duplicate submission yields exactly ONE booking and consumes capacity once.
--   * requestFingerprint is a server-side SHA-256 of the booking SELECTORS (serviceId, priceId,
--     availabilityId, validated seats) — never client-supplied money. Same key + same fingerprint
--     = idempotent replay of the original booking; same key + different fingerprint = conflict.
--   * FK to customers is RESTRICT (ownership scope; a customer with keys must not vanish);
--     FK to bookings is RESTRICT (the row points at a real committed booking — release, not orphan).
-- No DROP, no DELETE, no UPDATE, no enum change, no mutation of any existing table. Rollback-safe
-- (DROP TABLE). Applied to staging only via the established deploy pipeline; production untouched.

-- CreateTable
CREATE TABLE "booking_idempotency_keys" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "bookingId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_idempotency_keys_bookingId_key" ON "booking_idempotency_keys"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_idempotency_keys_customerId_idempotencyKey_key" ON "booking_idempotency_keys"("customerId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "booking_idempotency_keys" ADD CONSTRAINT "booking_idempotency_keys_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_idempotency_keys" ADD CONSTRAINT "booking_idempotency_keys_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
