-- Phase 3C — Vehicle Registration Workflow, Slice 3A (provider confirmation claim).
-- ADDITIVE ONLY: one new enum + one new PRIVATE table linked to providers/assets/asset_documents/
-- vehicle_registration_extractions (all FKs ON DELETE CASCADE — a confirmation is subordinate to
-- its document/extraction and can never delete Vehicle/booking history). NO change to any existing
-- table/column, NO backfill, NO destructive DDL. Holds no raw PDF text and no owner/civil/address/
-- insurer/signature/barcode PII. The authoritative Vehicle row is never written by this slice.

-- CreateEnum
CREATE TYPE "VehicleRegistrationConfirmationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "vehicle_registration_confirmations" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "assetDocumentId" UUID NOT NULL,
    "extractionId" UUID NOT NULL,
    "boundDocumentSha256" TEXT NOT NULL,
    "boundParserVersion" TEXT NOT NULL,
    "status" "VehicleRegistrationConfirmationStatus" NOT NULL DEFAULT 'DRAFT',
    "make" TEXT,
    "model" TEXT,
    "modelYear" INTEGER,
    "color" TEXT,
    "bookablePassengerCapacity" INTEGER,
    "licensedPassengerCapacity" INTEGER,
    "registeredSeats" INTEGER,
    "vin" TEXT,
    "plateNumber" TEXT,
    "plateType" TEXT,
    "engineNumber" TEXT,
    "usageClassification" TEXT,
    "engineCapacity" INTEGER,
    "emptyWeight" INTEGER,
    "maximumLoad" INTEGER,
    "axleCount" INTEGER,
    "licenseValidFrom" TEXT,
    "licenseExpiry" TEXT,
    "firstRegistrationDate" TEXT,
    "fieldDecisions" JSONB,
    "declarationAccepted" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMPTZ(6),
    "submittedByUserId" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicle_registration_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_registration_confirmations_assetDocumentId_idx" ON "vehicle_registration_confirmations"("assetDocumentId");

-- CreateIndex
CREATE INDEX "vehicle_registration_confirmations_providerId_idx" ON "vehicle_registration_confirmations"("providerId");

-- CreateIndex
CREATE INDEX "vehicle_registration_confirmations_assetId_idx" ON "vehicle_registration_confirmations"("assetId");

-- CreateIndex
CREATE INDEX "vehicle_registration_confirmations_status_idx" ON "vehicle_registration_confirmations"("status");

-- AddForeignKey
ALTER TABLE "vehicle_registration_confirmations" ADD CONSTRAINT "vehicle_registration_confirmations_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_registration_confirmations" ADD CONSTRAINT "vehicle_registration_confirmations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_registration_confirmations" ADD CONSTRAINT "vehicle_registration_confirmations_assetDocumentId_fkey" FOREIGN KEY ("assetDocumentId") REFERENCES "asset_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_registration_confirmations" ADD CONSTRAINT "vehicle_registration_confirmations_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "vehicle_registration_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RAW PARTIAL UNIQUE INDEX (not expressible in the Prisma model): at most ONE ACTIVE
-- (non-SUPERSEDED) confirmation per document. SUPERSEDED rows are retained as history; a replaced
-- document supersedes the active claim and a fresh one is created. Mirrors the established
-- partial-unique convention in this repo (slot/rental migrations).
CREATE UNIQUE INDEX "vehicle_registration_confirmations_active_doc_key" ON "vehicle_registration_confirmations"("assetDocumentId") WHERE "status" <> 'SUPERSEDED';

