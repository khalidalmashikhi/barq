-- Phase 3C Slice C3/E2 — Booking rental snapshot + provider-response deadline (additive).
--
-- REWRITTEN (C3/E2 correction) BEFORE ANY SHARED-ENVIRONMENT APPLICATION: this migration has only
-- ever been applied to disposable PostgreSQL. The final sequence from the migration-57 baseline is
-- still a SINGLE additive migration 58. The correction adds a second additive nullable column.
--
-- ADDITIVE / INERT-TO-LEGACY. Adds TWO nullable columns to the existing `bookings` table:
--   • rentalSnapshot JSONB — the immutable customer-safe rental snapshot AND the rental discriminator
--     for a daily-rental Booking (NON-NULL only for bookings created by confirming a C3/E1 hold; NULL
--     for every legacy / slot / tour booking).
--   • providerResponseDeadlineAt TIMESTAMPTZ — the server-owned deadline by which the provider must
--     accept/reject a rental PENDING_PROVIDER booking before it auto-expires (releasing its daily
--     inventory). NULL for every non-rental booking (they keep the Availability-based stale expiry).
--
-- There is NO backfill, NO data UPDATE/DELETE, NO destructive DDL, NO column drop/rename/retype, and
-- NO change to any other table (no VehicleReservation, no rental_vehicle_day_* tables, no guided
-- tables). Both columns are nullable with no default, so every existing Booking row is valid and
-- unchanged. The hold-group→Booking link continues to live on rental_vehicle_day_hold_groups.bookingId
-- (added in migration 57); no new FK is needed here.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "rentalSnapshot" JSONB;
-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "providerResponseDeadlineAt" TIMESTAMPTZ(6);
