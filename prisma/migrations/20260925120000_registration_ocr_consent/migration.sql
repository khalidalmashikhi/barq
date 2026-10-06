-- Phase 3C (registration OCR privacy / consent gate) — ADDITIVE ONLY.
-- One new enum, one new table (durable proof of the provider's decision about sending ONE
-- registration document to the external AI processor) and two NULLABLE columns on the private
-- "vehicle_registration_extractions" table. No existing table, column, index or row is altered or
-- backfilled; nothing is dropped or retyped. The consent table deliberately OUTLIVES the setup and
-- the document it refers to: both foreign keys are SET NULL on delete, so the proof remains.
-- It never holds document contents, an API key or a document value.

-- CreateEnum
CREATE TYPE "VehicleRegistrationOcrConsentDecision" AS ENUM ('GRANTED', 'DECLINED');

-- AlterTable
ALTER TABLE "vehicle_registration_extractions" ADD COLUMN     "ocrCallCount" INTEGER,
ADD COLUMN     "ocrInferenceGeo" TEXT;

-- CreateTable
CREATE TABLE "vehicle_registration_ocr_consents" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "assetId" UUID,
    "assetDocumentId" UUID,
    "documentSha256" TEXT,
    "decision" "VehicleRegistrationOcrConsentDecision" NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "processor" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "inferenceGeo" TEXT,
    "locale" TEXT NOT NULL,
    "ownerAuthorizationConfirmed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_registration_ocr_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_registration_ocr_consents_assetDocumentId_createdAt_idx" ON "vehicle_registration_ocr_consents"("assetDocumentId", "createdAt");

-- CreateIndex
CREATE INDEX "vehicle_registration_ocr_consents_providerId_createdAt_idx" ON "vehicle_registration_ocr_consents"("providerId", "createdAt");

-- AddForeignKey
ALTER TABLE "vehicle_registration_ocr_consents" ADD CONSTRAINT "vehicle_registration_ocr_consents_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_registration_ocr_consents" ADD CONSTRAINT "vehicle_registration_ocr_consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_registration_ocr_consents" ADD CONSTRAINT "vehicle_registration_ocr_consents_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_registration_ocr_consents" ADD CONSTRAINT "vehicle_registration_ocr_consents_assetDocumentId_fkey" FOREIGN KEY ("assetDocumentId") REFERENCES "asset_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
