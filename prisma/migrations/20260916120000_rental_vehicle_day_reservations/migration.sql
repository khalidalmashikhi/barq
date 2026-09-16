-- Phase 3C Slice C3/E1 — Daily-rental vehicle/day RESERVATION authority (additive).
--
-- ADDITIVE / INERT-TO-LEGACY. Creates 1 new enum + 1 new table (rental_vehicle_day_reservations)
-- + its indexes, foreign keys, row-local CHECK constraints, and ONE raw PARTIAL UNIQUE INDEX that
-- is the sole DB-level arbiter for the core safety invariant (one ACTIVE reservation per physical
-- vehicle per Oman calendar day).
--
-- It touches NO existing table. There is NO change to services / vehicles / customers / bookings /
-- rental_offerings / vehicle_reservations / guided_tour_* — no column, nullability, default, type,
-- or data change anywhere; NO backfill; NO rewrite of any existing VehicleReservation or Booking
-- row. The legacy interval VehicleReservation table and all six of its callers are untouched. Every
-- new foreign key is ON DELETE RESTRICT (these reservations are archival history, never row-deleted
-- via a parent). The Customer / Service / RentalOffering / Vehicle / Booking Prisma models gained
-- VIRTUAL back-relation fields only (no column, no DDL). No cron / scheduler is added.

-- CreateEnum
CREATE TYPE "RentalReservationStatus" AS ENUM ('HELD', 'CONFIRMED', 'RELEASED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "rental_vehicle_day_reservations" (
    "id" UUID NOT NULL,
    "holdGroupId" UUID NOT NULL,
    "holdToken" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "rentalOfferingId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "serviceDate" DATE NOT NULL,
    "status" "RentalReservationStatus" NOT NULL DEFAULT 'HELD',
    "dailyAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "priceSource" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "releasedAt" TIMESTAMPTZ(6),
    "bookingId" UUID,
    "idempotencyKey" TEXT,
    "requestFingerprint" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_vehicle_day_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_vehicle_day_reservations_holdGroupId_idx" ON "rental_vehicle_day_reservations"("holdGroupId");
-- CreateIndex
CREATE INDEX "rental_vehicle_day_reservations_vehicleId_serviceDate_idx" ON "rental_vehicle_day_reservations"("vehicleId", "serviceDate");
-- CreateIndex
CREATE INDEX "rental_vehicle_day_reservations_customerId_idempotencyKey_idx" ON "rental_vehicle_day_reservations"("customerId", "idempotencyKey");
-- CreateIndex
CREATE INDEX "rental_vehicle_day_reservations_status_expiresAt_idx" ON "rental_vehicle_day_reservations"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_rentalOfferingId_fkey" FOREIGN KEY ("rentalOfferingId") REFERENCES "rental_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("assetId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row-local CHECK constraints (Prisma 5.22 cannot express CHECKs in the DSL — same convention as
-- the availabilities / bookings / rental_offerings CHECKs). The daily amount is positive; the
-- price source is a closed 2-value code set; and a HELD row MUST carry an expiry (a temporary hold
-- always has a server-owned expiresAt), while a CONFIRMED row MUST NOT (it never auto-expires).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_daily_amount_positive" CHECK ("dailyAmount" > 0);
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_price_source_valid" CHECK ("priceSource" IN ('BASE', 'OVERRIDE'));
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_held_has_expiry" CHECK ("status" <> 'HELD' OR "expiresAt" IS NOT NULL);
ALTER TABLE "rental_vehicle_day_reservations" ADD CONSTRAINT "rental_vehicle_day_reservations_confirmed_no_expiry" CHECK ("status" <> 'CONFIRMED' OR "expiresAt" IS NULL);

-- ---------------------------------------------------------------------------------------------
-- THE SAFETY INVARIANT (business rule 10): a physical vehicle must never have two ACTIVE rental
-- reservations for the same Oman calendar day. Enforced at the DATABASE level by a PARTIAL UNIQUE
-- INDEX on (vehicleId, serviceDate) restricted to the ACTIVE (blocking) states — HELD and
-- CONFIRMED. RELEASED / EXPIRED / CANCELLED rows are EXEMPT, so historical rows stay for audit and
-- never block re-acquisition of a freed day. Prisma 5.22 cannot express a PARTIAL (WHERE) unique in
-- the DSL, so this is raw and intentionally NOT in the schema.prisma model (same convention as
-- bookings_active_slot_per_customer_key / rental_offerings_active_per_service_vehicle_key). This
-- index — not any application pre-check, JS lock, count query, or process mutex — is the sole race
-- arbiter: two concurrent acquisitions of the same vehicle/day contend on it, exactly one INSERT
-- commits, and the loser's whole transaction rolls back (no partial hold).
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "rental_vehicle_day_reservations_active_vehicle_date_key"
    ON "rental_vehicle_day_reservations" ("vehicleId", "serviceDate")
    WHERE "status" IN ('HELD', 'CONFIRMED');
