-- SERVICE INFORMATION MODEL (Booking Decision Data) — Implementation Gate 1.
--
-- ADDITIVE / LEGACY-SAFE ONLY. Seven new NULLABLE columns on the existing "services" table;
-- no existing row, column, enum, index, constraint, or table is touched. No backfill — every
-- existing service keeps these NULL and stays fully valid and public. No fake defaults
-- (no duration=60, no invented inclusions/capacity). No DROP/DELETE/UPDATE, no enum change,
-- no NOT NULL, no default. Reversible by dropping the columns.
--
-- Service-type NEUTRAL: these apply across tours, transport, vehicles, guides, transfers,
-- marine trips, etc. Semantics (see schema.prisma):
--   durationMinutes      — canonical duration in minutes (UI localizes); optional.
--   startInstructions    — bilingual { ar, en } operational start (meet/pickup/delivery/marina).
--   inclusions/exclusions/customerRequirements — bilingual { ar: string[], en: string[] }.
--   minBookingSeats/maxBookingSeats — per-BOOKING seat bounds (NOT Availability.capacity).

-- AlterTable
ALTER TABLE "services" ADD COLUMN "durationMinutes" INTEGER;
ALTER TABLE "services" ADD COLUMN "startInstructions" JSONB;
ALTER TABLE "services" ADD COLUMN "inclusions" JSONB;
ALTER TABLE "services" ADD COLUMN "exclusions" JSONB;
ALTER TABLE "services" ADD COLUMN "customerRequirements" JSONB;
ALTER TABLE "services" ADD COLUMN "minBookingSeats" INTEGER;
ALTER TABLE "services" ADD COLUMN "maxBookingSeats" INTEGER;
