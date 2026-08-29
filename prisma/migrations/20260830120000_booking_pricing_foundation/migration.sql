-- BOOKING PRICING FOUNDATION — Pricing Foundation Gate (INERT).
--
-- ADDITIVE / LEGACY-SAFE ONLY. Three new NULLABLE columns on the existing "bookings" table.
-- No existing row, column, enum, index, table, or the priceSnapshotAmount/currency/seats/
-- commission/Payment/Invoice models are touched. No backfill — every existing booking keeps
-- these NULL and retains its LEGACY semantics (effective total = priceSnapshotAmount, the
-- unit price; NEVER retroactively multiplied by seats). No fake defaults, no DROP/DELETE/
-- UPDATE, no enum change, no NOT NULL, no default, no data rewrite. Reversible by dropping
-- the columns and constraints.
--
-- Semantics (see schema.prisma Booking):
--   pricingUnitSnapshot      — immutable pricing basis CODE at booking time (e.g. PER_PERSON).
--   billableQuantitySnapshot — immutable multiplier the total was computed from (NOT seats).
--   bookingTotalSnapshot     — authoritative calculated booking total; NULL => LEGACY booking.
--
-- INERT: nothing in the current runtime writes these; createBooking/acceptBooking are
-- unchanged, so all three stay NULL for every booking created after this migration too.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "pricingUnitSnapshot" TEXT;
ALTER TABLE "bookings" ADD COLUMN "billableQuantitySnapshot" INTEGER;
ALTER TABLE "bookings" ADD COLUMN "bookingTotalSnapshot" DECIMAL(12,2);

-- CHECK constraints — raw SQL (not Prisma DSL), defense-in-depth, mirroring the existing
-- "bookings_seats_positive" precedent. Each is NULL-tolerant, so it is satisfied by every
-- existing row (all NULL) and only ever constrains a future non-NULL write. Application
-- validation (the pure calculator / resolver) remains the primary authority.
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_billable_quantity_positive"
  CHECK ("billableQuantitySnapshot" IS NULL OR "billableQuantitySnapshot" > 0);

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_booking_total_nonnegative"
  CHECK ("bookingTotalSnapshot" IS NULL OR "bookingTotalSnapshot" >= 0);
