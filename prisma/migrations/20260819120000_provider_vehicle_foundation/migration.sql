-- VEHICLE-1 — Provider Vehicle Foundation (schema + domain).
--
-- ADDITIVE / EVOLUTIONARY ONLY. Safe to apply even if a legacy/inert `vehicles`
-- row exists (the table was created at init): every new column is NULLABLE, and
-- relaxing a NOT NULL constraint never fails on existing data. No DROP TABLE, no
-- row delete, no backfill, no Service/Booking/ProviderCategory mutation.

-- registrationNumber becomes PRIVATE + OPTIONAL. The existing unique index
-- ("vehicles_registrationNumber_key") is preserved and already permits multiple
-- NULLs in PostgreSQL, so non-null duplicates stay prevented without a partial
-- index. Relaxing NOT NULL is a metadata-only, data-safe change.
ALTER TABLE "vehicles" ALTER COLUMN "registrationNumber" DROP NOT NULL;

-- Customer-safe structured fields. All NULLABLE at the DB layer (compat-safe);
-- the domain contract (src/lib/vehicles/vehicle-input.ts) requires make/model/
-- vehicleType/passengerCapacity for every new write.
ALTER TABLE "vehicles" ADD COLUMN "make" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "model" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "modelYear" INTEGER;
ALTER TABLE "vehicles" ADD COLUMN "color" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "vehicleType" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "passengerCapacity" INTEGER;
ALTER TABLE "vehicles" ADD COLUMN "publicDescription" TEXT;
