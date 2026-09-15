-- Phase 3C Slice C1 — Vehicle-based daily offering FOUNDATIONS (inert).
--
-- ADDITIVE / INERT ONLY. Creates 4 new enums + 6 new tables (two fully-separate vertical
-- families: rental_* for RENTAL_COMPANY, guided_tour_vehicle_* for TOURIST_GUIDE) + their
-- indexes, unique constraints, and foreign keys, plus row-local CHECK constraints and two
-- raw partial UNIQUE indexes.
--
-- It touches NO existing table. There is NO change to services / vehicles / prices / bookings /
-- vehicle_reservations, NO data UPDATE/DELETE/backfill, NO existing-column nullability/default/
-- type change, and NO pricing-unit-registry change (PER_DAY / PER_VEHICLE_DAY untouched). Every
-- new foreign key is ON DELETE RESTRICT so an offering, day, or historical rate record can never
-- disappear through a parent (Service / Vehicle / offering / day) deletion — these models are
-- archival, never row-deleted. The Vehicle/Service Prisma models gained VIRTUAL back-relation
-- fields only (no column, no DDL). No application behavior is wired in this slice.

-- CreateEnum
CREATE TYPE "RentalOfferingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED');
-- CreateEnum
CREATE TYPE "GuidedTourVehicleOfferingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED', 'ARCHIVED');
-- CreateEnum
CREATE TYPE "OfferingDayState" AS ENUM ('OPEN', 'BLOCKED');
-- CreateEnum
CREATE TYPE "StartTimeState" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "rental_offerings" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "baseDailyAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "offeringCapacityOverride" INTEGER,
    "status" "RentalOfferingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_offerings_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "rental_offering_days" (
    "id" UUID NOT NULL,
    "rentalOfferingId" UUID NOT NULL,
    "serviceDate" DATE NOT NULL,
    "state" "OfferingDayState" NOT NULL DEFAULT 'BLOCKED',
    "dailyAmountOverride" DECIMAL(12,2),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_offering_days_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "rental_start_times" (
    "id" UUID NOT NULL,
    "rentalOfferingDayId" UUID NOT NULL,
    "startTimeMinutes" INTEGER NOT NULL,
    "state" "StartTimeState" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "rental_start_times_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "guided_tour_vehicle_offerings" (
    "id" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "baseDailyAmount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "offeringCapacityOverride" INTEGER,
    "status" "GuidedTourVehicleOfferingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "guided_tour_vehicle_offerings_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "guided_tour_vehicle_offering_days" (
    "id" UUID NOT NULL,
    "guidedTourVehicleOfferingId" UUID NOT NULL,
    "serviceDate" DATE NOT NULL,
    "state" "OfferingDayState" NOT NULL DEFAULT 'BLOCKED',
    "dailyAmountOverride" DECIMAL(12,2),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "guided_tour_vehicle_offering_days_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "guided_tour_vehicle_start_times" (
    "id" UUID NOT NULL,
    "guidedTourVehicleOfferingDayId" UUID NOT NULL,
    "startTimeMinutes" INTEGER NOT NULL,
    "state" "StartTimeState" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "guided_tour_vehicle_start_times_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_offerings_serviceId_idx" ON "rental_offerings"("serviceId");
-- CreateIndex
CREATE INDEX "rental_offerings_vehicleId_idx" ON "rental_offerings"("vehicleId");
-- CreateIndex
CREATE INDEX "rental_offerings_status_idx" ON "rental_offerings"("status");
-- CreateIndex
CREATE INDEX "rental_offering_days_rentalOfferingId_idx" ON "rental_offering_days"("rentalOfferingId");
-- CreateIndex
CREATE UNIQUE INDEX "rental_offering_days_rentalOfferingId_serviceDate_key" ON "rental_offering_days"("rentalOfferingId", "serviceDate");
-- CreateIndex
CREATE INDEX "rental_start_times_rentalOfferingDayId_idx" ON "rental_start_times"("rentalOfferingDayId");
-- CreateIndex
CREATE UNIQUE INDEX "rental_start_times_rentalOfferingDayId_startTimeMinutes_key" ON "rental_start_times"("rentalOfferingDayId", "startTimeMinutes");
-- CreateIndex
CREATE INDEX "guided_tour_vehicle_offerings_serviceId_idx" ON "guided_tour_vehicle_offerings"("serviceId");
-- CreateIndex
CREATE INDEX "guided_tour_vehicle_offerings_vehicleId_idx" ON "guided_tour_vehicle_offerings"("vehicleId");
-- CreateIndex
CREATE INDEX "guided_tour_vehicle_offerings_status_idx" ON "guided_tour_vehicle_offerings"("status");
-- CreateIndex
CREATE INDEX "guided_tour_vehicle_offering_days_guidedTourVehicleOffering_idx" ON "guided_tour_vehicle_offering_days"("guidedTourVehicleOfferingId");
-- CreateIndex
CREATE UNIQUE INDEX "guided_tour_vehicle_offering_days_guidedTourVehicleOffering_key" ON "guided_tour_vehicle_offering_days"("guidedTourVehicleOfferingId", "serviceDate");
-- CreateIndex
CREATE INDEX "guided_tour_vehicle_start_times_guidedTourVehicleOfferingDa_idx" ON "guided_tour_vehicle_start_times"("guidedTourVehicleOfferingDayId");
-- CreateIndex
CREATE UNIQUE INDEX "guided_tour_vehicle_start_times_guidedTourVehicleOfferingDa_key" ON "guided_tour_vehicle_start_times"("guidedTourVehicleOfferingDayId", "startTimeMinutes");

-- AddForeignKey
ALTER TABLE "rental_offerings" ADD CONSTRAINT "rental_offerings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_offerings" ADD CONSTRAINT "rental_offerings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("assetId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_offering_days" ADD CONSTRAINT "rental_offering_days_rentalOfferingId_fkey" FOREIGN KEY ("rentalOfferingId") REFERENCES "rental_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "rental_start_times" ADD CONSTRAINT "rental_start_times_rentalOfferingDayId_fkey" FOREIGN KEY ("rentalOfferingDayId") REFERENCES "rental_offering_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "guided_tour_vehicle_offerings" ADD CONSTRAINT "guided_tour_vehicle_offerings_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "guided_tour_vehicle_offerings" ADD CONSTRAINT "guided_tour_vehicle_offerings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("assetId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "guided_tour_vehicle_offering_days" ADD CONSTRAINT "guided_tour_vehicle_offering_days_guidedTourVehicleOfferin_fkey" FOREIGN KEY ("guidedTourVehicleOfferingId") REFERENCES "guided_tour_vehicle_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "guided_tour_vehicle_start_times" ADD CONSTRAINT "guided_tour_vehicle_start_times_guidedTourVehicleOfferingD_fkey" FOREIGN KEY ("guidedTourVehicleOfferingDayId") REFERENCES "guided_tour_vehicle_offering_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Row-local CHECK constraints (Prisma 5.22 cannot express CHECKs in the DSL — same convention as
-- the availabilities/bookings CHECKs). Money must be positive; the optional capacity override and
-- the day override are positive WHEN present; Oman-local start minutes are within a day.
-- The cross-table rule (offeringCapacityOverride <= vehicle.bookablePassengerCapacity) CANNOT be a
-- row-local CHECK (it spans tables) — it is enforced by future C2b server writes; NO trigger here.
-- Currency deliberately has NO format CHECK (free String, same contract as prices.currency).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "rental_offerings" ADD CONSTRAINT "rental_offerings_base_daily_amount_positive" CHECK ("baseDailyAmount" > 0);
ALTER TABLE "rental_offerings" ADD CONSTRAINT "rental_offerings_capacity_override_positive" CHECK ("offeringCapacityOverride" IS NULL OR "offeringCapacityOverride" > 0);
ALTER TABLE "rental_offering_days" ADD CONSTRAINT "rental_offering_days_daily_override_positive" CHECK ("dailyAmountOverride" IS NULL OR "dailyAmountOverride" > 0);
ALTER TABLE "rental_start_times" ADD CONSTRAINT "rental_start_times_minutes_range" CHECK ("startTimeMinutes" BETWEEN 0 AND 1439);

ALTER TABLE "guided_tour_vehicle_offerings" ADD CONSTRAINT "guided_tour_vehicle_offerings_base_daily_amount_positive" CHECK ("baseDailyAmount" > 0);
ALTER TABLE "guided_tour_vehicle_offerings" ADD CONSTRAINT "guided_tour_vehicle_offerings_capacity_override_positive" CHECK ("offeringCapacityOverride" IS NULL OR "offeringCapacityOverride" > 0);
ALTER TABLE "guided_tour_vehicle_offering_days" ADD CONSTRAINT "guided_tour_vehicle_offering_days_daily_override_positive" CHECK ("dailyAmountOverride" IS NULL OR "dailyAmountOverride" > 0);
ALTER TABLE "guided_tour_vehicle_start_times" ADD CONSTRAINT "guided_tour_vehicle_start_times_minutes_range" CHECK ("startTimeMinutes" BETWEEN 0 AND 1439);

-- ---------------------------------------------------------------------------------------------
-- One ACTIVE (non-archived) offering per (serviceId, vehicleId), per vertical. Prisma 5.22 cannot
-- express a PARTIAL (WHERE) unique index in the DSL, so these are raw and intentionally NOT in the
-- schema.prisma model (same convention as bookings_active_slot_per_customer_key). ARCHIVED rows are
-- EXEMPT, so any number of historical/archived offerings may coexist while only one non-archived
-- offering exists per (serviceId, vehicleId).
-- ---------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX "rental_offerings_active_per_service_vehicle_key"
    ON "rental_offerings" ("serviceId", "vehicleId")
    WHERE "status" <> 'ARCHIVED';
CREATE UNIQUE INDEX "guided_tour_vehicle_offerings_active_per_service_vehicle_key"
    ON "guided_tour_vehicle_offerings" ("serviceId", "vehicleId")
    WHERE "status" <> 'ARCHIVED';
