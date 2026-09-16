-- Phase 3C Slice C3/E1 — Daily-rental vehicle/day RESERVATION authority (additive).
--
-- REWRITTEN (idempotency-integrity correction) BEFORE ANY SHARED-ENVIRONMENT APPLICATION: this
-- migration has only ever been applied to disposable PostgreSQL. The final sequence from the
-- migration-56 baseline is still a SINGLE additive migration 57. The correction splits the original
-- single flat table into a HOLD-GROUP header + per-day child rows so that group-level idempotency is
-- DB-ENFORCED (UNIQUE(customerId, idempotencyKey) on the header), independent of the number of date
-- rows — the original flat design had only a NON-unique (customerId, idempotencyKey) index and could
-- not prevent two logical groups for one (customer, key).
--
-- ADDITIVE / INERT-TO-LEGACY. Creates 1 new enum + 2 new tables (rental_vehicle_day_hold_groups +
-- rental_vehicle_day_reservations) + indexes, foreign keys, row-local CHECKs, ONE unique on the
-- header (customerId, idempotencyKey), and ONE raw PARTIAL UNIQUE INDEX on the child rows (the core
-- safety invariant: one ACTIVE reservation per physical vehicle per Oman calendar day).
--
-- It touches NO existing table. NO change to services / vehicles / customers / bookings /
-- rental_offerings / vehicle_reservations / guided_tour_* — no column, nullability, default, type,
-- or data change; NO backfill; NO rewrite of any existing VehicleReservation or Booking row. The
-- legacy interval VehicleReservation and its six callers are untouched. Every new foreign key is ON
-- DELETE RESTRICT (these reservations are archival history, never row-deleted via a parent; groups
-- are never deleted, so historical idempotency replay stays stable). Customer / Service /
-- RentalOffering / Vehicle / Booking gained VIRTUAL back-relation fields only (no column, no DDL).
-- No cron / scheduler is added.

-- CreateEnum
CREATE TYPE "RentalReservationStatus" AS ENUM ('HELD', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'CANCELLED');

-- CreateTable (HEADER — the logical hold identity + authoritative quote snapshot)
CREATE TABLE "rental_vehicle_day_hold_groups" (
    "id" UUID NOT NULL,
    "holdToken" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "rentalOfferingId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "passengerCount" INTEGER NOT NULL,
    "idempotencyKey" TEXT,
    "requestFingerprint" TEXT,
    "quoteFingerprint" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "bookingId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_vehicle_day_hold_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable (CHILD — one physical vehicle/day, with the mutable lifecycle + per-date price)
CREATE TABLE "rental_vehicle_day_reservations" (
    "id" UUID NOT NULL,
    "holdGroupId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "serviceDate" DATE NOT NULL,
    "status" "RentalReservationStatus" NOT NULL DEFAULT 'HELD',
    "dailyAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "priceSource" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "releasedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_vehicle_day_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (header)
CREATE INDEX "rental_vehicle_day_hold_groups_vehicleId_idx" ON "rental_vehicle_day_hold_groups"("vehicleId");
-- CreateIndex
CREATE INDEX "rental_vehicle_day_hold_groups_bookingId_idx" ON "rental_vehicle_day_hold_groups"("bookingId");
-- CreateIndex (child)
CREATE INDEX "rental_vehicle_day_reservations_holdGroupId_idx" ON "rental_vehicle_day_reservations"("holdGroupId");
-- CreateIndex
CREATE INDEX "rental_vehicle_day_reservations_vehicleId_serviceDate_idx" ON "rental_vehicle_day_reservations"("vehicleId", "serviceDate");
-- CreateIndex
CREATE INDEX "rental_vehicle_day_reservations_status_expiresAt_idx" ON "rental_vehicle_day_reservations"("status", "expiresAt");

-- AddForeignKey (header)
ALTER TABLE "rental_vehicle_day_hold_groups" ADD CONSTRAINT "rental_vehicle_day_hold_groups_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_vehicle_day_hold_groups" ADD CONSTRAINT "rental_vehicle_day_hold_groups_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_vehicle_day_hold_groups" ADD CONSTRAINT "rental_vehicle_day_hold_groups_rentalOfferingId_fkey" FOREIGN KEY ("rentalOfferingId") REFERENCES "rental_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_vehicle_day_hold_groups" ADD CONSTRAINT "rental_vehicle_day_hold_groups_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("assetId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_vehicle_day_hold_groups" ADD CONSTRAINT "rental_vehicle_day_hold_groups_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey (child → header + vehicle)
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_holdGroupId_fkey" FOREIGN KEY ("holdGroupId") REFERENCES "rental_vehicle_day_hold_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("assetId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row-local CHECK constraints (Prisma 5.22 cannot express CHECKs in the DSL — same convention as
-- availabilities / bookings / rental_offerings). Header: total + passenger count positive. Child:
-- daily amount positive; price source a closed 2-value code set; a HELD row MUST carry an expiry (a
-- temporary hold always has a server-owned expiresAt) while a CONFIRMED row MUST NOT (never expires).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "rental_vehicle_day_hold_groups" ADD CONSTRAINT "rental_vehicle_day_hold_groups_total_positive" CHECK ("totalAmount" > 0);
ALTER TABLE "rental_vehicle_day_hold_groups" ADD CONSTRAINT "rental_vehicle_day_hold_groups_passengers_positive" CHECK ("passengerCount" > 0);
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_daily_amount_positive" CHECK ("dailyAmount" > 0);
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_price_source_valid" CHECK ("priceSource" IN ('BASE', 'OVERRIDE'));
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_held_has_expiry" CHECK ("status" <> 'HELD' OR "expiresAt" IS NOT NULL);
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_confirmed_no_expiry" CHECK ("status" <> 'CONFIRMED' OR "expiresAt" IS NULL);

-- ---------------------------------------------------------------------------------------------
-- THE GROUP IDEMPOTENCY ARBITER (business rule: one logical request per (customer, idempotency key)).
-- A standard UNIQUE index; a NULL idempotencyKey (a hold acquired without a client key) is EXEMPT
-- because Postgres treats NULLs as DISTINCT in a unique index — so unlimited keyless groups may
-- coexist for one customer, while at most one keyed group can. Two concurrent same-key inserts
-- serialize on this index: exactly one commits, the other gets a unique violation, re-reads the
-- winner, and replays (same fingerprint) or fails with IDEMPOTENCY_MISMATCH (different fingerprint).
-- This — not any application pre-check, findFirst, JS lock, or the child vehicle/day index — is the
-- group-level idempotency authority, independent of how many child date rows the hold has.
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "rental_vehicle_day_hold_groups_customerId_idempotencyKey_key"
    ON "rental_vehicle_day_hold_groups" ("customerId", "idempotencyKey");

-- ---------------------------------------------------------------------------------------------
-- THE SAFETY INVARIANT (business rule 10): a physical vehicle must never have two ACTIVE rental
-- reservations for the same Oman calendar day. Enforced at the DATABASE level by a PARTIAL UNIQUE
-- INDEX on the CHILD rows (vehicleId, serviceDate) restricted to the ACTIVE (blocking) states — HELD
-- and CONFIRMED. RELEASED / EXPIRED / CANCELLED rows are EXEMPT, so historical rows stay for audit
-- and never block re-acquisition of a freed day. Prisma 5.22 cannot express a PARTIAL (WHERE) unique
-- in the DSL, so this is raw and intentionally NOT in the schema.prisma model (same convention as
-- bookings_active_slot_per_customer_key). This index is the sole race arbiter for the physical
-- vehicle/day: two concurrent acquisitions of the same vehicle/day contend on it, exactly one INSERT
-- commits, and the loser's whole transaction (header + all child rows + audit) rolls back.
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "rental_vehicle_day_reservations_active_vehicle_date_key"
    ON "rental_vehicle_day_reservations" ("vehicleId", "serviceDate")
    WHERE "status" IN ('HELD', 'CONFIRMED');
