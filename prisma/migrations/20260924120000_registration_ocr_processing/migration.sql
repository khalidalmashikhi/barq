-- Phase 3C (registration OCR) — ADDITIVE ONLY.
-- One new enum value, three NULLABLE columns and one index on the private
-- "vehicle_registration_extractions" table. No existing row is updated or backfilled (the new
-- columns are NULL for every existing extraction; no existing row uses the new enum value), no
-- column is dropped or retyped, and no other table is touched.

-- AlterEnum
ALTER TYPE "VehicleRegistrationExtractionStatus" ADD VALUE 'PROCESSING';

-- AlterTable
ALTER TABLE "vehicle_registration_extractions" ADD COLUMN     "ocrEngine" TEXT,
ADD COLUMN     "processingExpiresAt" TIMESTAMPTZ(6),
ADD COLUMN     "processingToken" UUID;

-- CreateIndex
CREATE INDEX "vehicle_registration_extractions_documentSha256_idx" ON "vehicle_registration_extractions"("documentSha256");
