-- Phase 3C Slice C3/E2 — Booking rental snapshot (additive).
--
-- ADDITIVE / INERT-TO-LEGACY. Adds exactly ONE nullable JSONB column to the existing `bookings`
-- table: `rentalSnapshot`. It is the immutable customer-safe rental snapshot AND the rental
-- discriminator for a daily-rental Booking (NON-NULL only for bookings created by confirming a
-- C3/E1 daily-rental hold; NULL for every legacy / slot / tour booking).
--
-- There is NO backfill, NO data UPDATE/DELETE, NO destructive DDL, NO column drop/rename/retype, and
-- NO change to any other table (no VehicleReservation, no rental_vehicle_day_* tables, no guided
-- tables). The column is nullable with no default, so every existing Booking row is valid and
-- unchanged (rentalSnapshot = NULL). The hold-group→Booking link continues to live on
-- rental_vehicle_day_hold_groups.bookingId (added in migration 57); no new FK is needed here.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "rentalSnapshot" JSONB;
