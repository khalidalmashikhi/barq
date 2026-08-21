-- TOUR-VEHICLE-CAP — verified 4x4 capability on vehicles.
--
-- Additive, nullable, legacy-safe: existing rows keep NULL for both columns.
-- claimedFourByFour = provider's advisory declaration; fourByFourVerified = the
-- admin-confirmed TRUSTED capability (the only value GUIDE_WITH_4X4 may consult).
-- A legacy NULL fourByFourVerified means NOT 4x4-capable (fail-closed). No backfill:
-- vehicleType/make/model are NOT authoritative for drivetrain and must never be
-- used to infer this value.
ALTER TABLE "vehicles" ADD COLUMN "claimedFourByFour" BOOLEAN;
ALTER TABLE "vehicles" ADD COLUMN "fourByFourVerified" BOOLEAN;
