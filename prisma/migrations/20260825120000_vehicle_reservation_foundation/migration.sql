-- BOOKING-CONFLICT-1A — the durable physical-occupancy reservation table that lets the
-- conflict engine guarantee a Vehicle is never double-booked for overlapping intervals.
--
-- ADDITIVE / LEGACY-SAFE ONLY. One brand-new table; no existing row, column, enum, index,
-- or constraint is touched. No backfill (existing confirmed bookings get NO reservation row —
-- nothing writes here until BOOKING-CONFLICT-1B wires acceptBooking).
--   * id is app-generated (uuid v7, ADR-0006) — no DB default, matching every other model.
--   * bookingId is UNIQUE — at most one reservation per booking.
--   * FK to vehicles is RESTRICT (a vehicle holding a reservation must not silently vanish);
--     FK to bookings is RESTRICT (a reservation is history — release it, don't orphan it).
--   * half-open window [startsAt, endsAt), absolute UTC instants; "endsAt > startsAt" and all
--     overlap/no-double-booking rules are enforced in application code (per-Vehicle advisory
--     xact lock + overlap check + insert in one transaction), NOT by a DB constraint. There is
--     deliberately NO btree_gist / EXCLUDE constraint (no CREATE EXTENSION precedent here).
--   * releasedAt NULL = active hold; set (not deleted) when released in a later gate.
-- No DROP, no DELETE, no UPDATE, no enum change, no Booking/Vehicle/Asset/Availability/
-- ProviderBusyPeriod mutation. NOT applied by this gate (local only).

-- CreateTable
CREATE TABLE "vehicle_reservations" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6) NOT NULL,
    "releasedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_reservations_bookingId_key" ON "vehicle_reservations"("bookingId");

-- CreateIndex
CREATE INDEX "vehicle_reservations_vehicleId_startsAt_endsAt_idx" ON "vehicle_reservations"("vehicleId", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "vehicle_reservations" ADD CONSTRAINT "vehicle_reservations_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("assetId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_reservations" ADD CONSTRAINT "vehicle_reservations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
