-- BOOKING-INTERVAL-1 — the unified, authoritative operational time window for a booking.
--
-- Additive, nullable, legacy-safe: every existing booking keeps NULL for both. NO backfill,
-- NO destructive change, NO NOT NULL. Absolute instants (timestamptz), half-open [start, end).
-- Populated at CREATE for slot-based bookings (snapshot of the selected Availability) and at
-- PROVIDER ACCEPTANCE for slotless vehicle-required bookings (provider-supplied). The
-- "start < end" and "required for a vehicle-required acceptance" rules are enforced in
-- application code (acceptBooking), not by a DB constraint. No overlap/reservation logic here
-- (that is BOOKING-CONFLICT-1).
ALTER TABLE "bookings" ADD COLUMN "operationalStartAt" TIMESTAMPTZ(6);
ALTER TABLE "bookings" ADD COLUMN "operationalEndAt" TIMESTAMPTZ(6);
