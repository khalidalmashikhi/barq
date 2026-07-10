-- Migration: availability_capacity_model
-- Engineering Sprint — Availability Engine Phase 1 (rebuilt fresh
-- against current main, base commit ce01923)
--
-- *** HAND-AUTHORED, NOT MACHINE-GENERATED *** — this sandbox has no
-- network access to run `npx prisma migrate dev` against a real
-- database. Verify against `npx prisma migrate diff` in a real
-- environment before trusting it blindly.
--
-- =============================================================================
-- 0. VEHICLE FK CORRECTION — a real, pre-existing bug found this turn,
-- not part of the originally-approved Availability Engine scope, but
-- necessary to include here since it changes what the vehicleId
-- foreign key legitimately points at.
--
-- Booking.vehicle has referenced Vehicle's non-existent "id" field
-- since the schema was first authored — Vehicle's actual primary key
-- is assetId (shared-PK Class Table Inheritance with Asset). This
-- would fail real `npx prisma validate` immediately; it went
-- undetected because that command has never once succeeded in this
-- project's sandbox (no network access, every prior sprint), so
-- nothing ever actually checked it.
--
-- DROP CONSTRAINT IF EXISTS is used defensively: because the old
-- reference was invalid, it is unlikely any real database ever
-- successfully created this constraint in the first place (Prisma
-- would have rejected it at migrate/push time) — this is written to
-- be safe whether or not it exists.
-- =============================================================================

ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_vehicleId_fkey";

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("assetId")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- 1. AvailabilitySlotState enum: remove BOOKED, add CANCELLED
-- =============================================================================
-- PostgreSQL has no "DROP VALUE" for enums — removing BOOKED requires
-- the standard workaround (rename old type, create new type, convert
-- the column with an explicit USING mapping, drop the old type).
-- Existing BOOKED rows map to OPEN: safe specifically because
-- bookedCount/capacity become the real source of truth for "how full"
-- a slot is after this migration — a bare state value no longer
-- carries that meaning.

ALTER TYPE "AvailabilitySlotState" RENAME TO "AvailabilitySlotState_old";

CREATE TYPE "AvailabilitySlotState" AS ENUM ('OPEN', 'BLOCKED', 'CANCELLED');

ALTER TABLE "availabilities"
  ALTER COLUMN "state" DROP DEFAULT,
  ALTER COLUMN "state" TYPE "AvailabilitySlotState" USING (
    CASE "state"::text
      WHEN 'BOOKED' THEN 'OPEN'
      ELSE "state"::text
    END
  )::"AvailabilitySlotState",
  ALTER COLUMN "state" SET DEFAULT 'OPEN';

DROP TYPE "AvailabilitySlotState_old";

-- =============================================================================
-- 2. Availability: capacity + bookedCount
-- =============================================================================

ALTER TABLE "availabilities" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "availabilities" ADD COLUMN "bookedCount" INTEGER NOT NULL DEFAULT 0;

-- =============================================================================
-- 3. Booking: seats + availabilityId
-- =============================================================================

ALTER TABLE "bookings" ADD COLUMN "seats" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "bookings" ADD COLUMN "availabilityId" UUID;

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_availabilityId_fkey"
  FOREIGN KEY ("availabilityId") REFERENCES "availabilities"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "bookings_availabilityId_idx" ON "bookings"("availabilityId");

-- =============================================================================
-- 4. CHECK constraints — raw SQL, not Prisma DSL
-- =============================================================================
-- This schema has no `previewFeatures` block enabled. Enabling one
-- solely to get native `@@check` DSL support at Prisma 5.22 would
-- itself be an unverified change this sandbox cannot confirm works
-- without the real CLI. Raw SQL works regardless of Prisma version.

ALTER TABLE "availabilities"
  ADD CONSTRAINT "availabilities_capacity_positive" CHECK ("capacity" > 0);

ALTER TABLE "availabilities"
  ADD CONSTRAINT "availabilities_bookedcount_nonnegative" CHECK ("bookedCount" >= 0);

ALTER TABLE "availabilities"
  ADD CONSTRAINT "availabilities_bookedcount_within_capacity" CHECK ("bookedCount" <= "capacity");

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_seats_positive" CHECK ("seats" > 0);

-- =============================================================================
-- NOTE: these CHECK constraints are a defense-in-depth backstop, not
-- the primary overbooking prevention mechanism. The primary
-- mechanism — an atomic conditional UPDATE on bookedCount inside the
-- same transaction as Booking creation — is application logic,
-- explicitly NOT built in this Phase 1 (database layer only).
-- =============================================================================
