-- Phase 3C — Vehicle Registration Extraction & Privacy Boundary, Slice 2
-- (Native PDF Text Extraction Engine + Private Extraction Record).
--
-- ADDITIVE ONLY. Adds one new enum and one new PRIVATE table linked to the existing
-- `assets` and `asset_documents`. NO change to any existing table/column — in particular
-- the `vehicles` capacity columns (bookable/registered/licensed) are untouched. NO data
-- UPDATE/DELETE, NO backfill, NO rename, NO destructive DDL. Both FKs are ON DELETE CASCADE
-- (an extraction is subordinate to its document/asset; deleting an extraction can never
-- touch Vehicle/booking history — the FKs point AT the document/asset, never the reverse).
-- The table is never public and holds no owner/insurance PII and no raw PDF text.

-- CreateEnum
CREATE TYPE "VehicleRegistrationExtractionStatus" AS ENUM ('EXTRACTED', 'NEEDS_REVIEW', 'FAILED');

-- CreateTable
CREATE TABLE "vehicle_registration_extractions" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "assetDocumentId" UUID NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "VehicleRegistrationExtractionStatus" NOT NULL,
    "failureCode" TEXT,
    "extractedVin" TEXT,
    "extractedPlateNumber" TEXT,
    "extractedLicensedPassengerCapacity" INTEGER,
    "extractedManufactureYear" INTEGER,
    "licenseExpiryDate" TEXT,
    "fields" JSONB,
    "warnings" JSONB,
    "processedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicle_registration_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_registration_extractions_assetDocumentId_key" ON "vehicle_registration_extractions"("assetDocumentId");

-- CreateIndex
CREATE INDEX "vehicle_registration_extractions_assetId_idx" ON "vehicle_registration_extractions"("assetId");

-- CreateIndex
CREATE INDEX "vehicle_registration_extractions_status_idx" ON "vehicle_registration_extractions"("status");

-- AddForeignKey
ALTER TABLE "vehicle_registration_extractions" ADD CONSTRAINT "vehicle_registration_extractions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_registration_extractions" ADD CONSTRAINT "vehicle_registration_extractions_assetDocumentId_fkey" FOREIGN KEY ("assetDocumentId") REFERENCES "asset_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

