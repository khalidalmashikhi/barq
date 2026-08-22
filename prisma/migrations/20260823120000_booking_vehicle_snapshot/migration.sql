-- BOOKING-VEHICLE-SNAPSHOT — historical, customer-safe assigned-vehicle snapshot on a booking.
--
-- Additive, nullable, legacy-safe: every existing booking keeps NULL. NO backfill, NO
-- destructive change. Written ONLY at provider acceptance, in the same transaction as
-- Booking.vehicleId (never by create-booking). It is an ALLOWLISTED presentation snapshot
-- (make/model/modelYear/color/passengerCapacity/vehicleType/isFourByFour) — never
-- registrationNumber, documents, objectKey, verificationStatus, or raw trusted/claimed 4x4.
-- Booking.vehicleId remains the AUTHORITATIVE relational assignment; this column is
-- immutable presentation history (ordinary Vehicle edits never rewrite it).
ALTER TABLE "bookings" ADD COLUMN "vehicleSnapshot" JSONB;
