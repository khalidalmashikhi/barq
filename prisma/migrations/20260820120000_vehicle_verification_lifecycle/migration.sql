-- VEHICLE-LC1 — Asset verification lifecycle + per-asset documents (schema foundation).
--
-- ADDITIVE / FAIL-CLOSED ONLY. Safe on existing `assets` rows:
--   * verificationStatus is added NOT NULL DEFAULT 'DRAFT' — every legacy asset
--     lands DRAFT (never APPROVED, never selectable) with no data rewrite.
--   * the other verification columns are nullable; `asset_documents` is a new
--     table; both enums are BRAND-NEW types (no `ALTER TYPE ADD VALUE`, so no
--     Postgres same-transaction enum restriction applies).
-- No DROP, no DELETE, no UPDATE of existing rows, no AssetStatus value changed,
-- no Booking/Service/ProviderCategory/ProviderDocument mutation. Admin FKs use
-- ON DELETE SET NULL to preserve review history; asset_documents cascade with
-- their owning asset. NOT applied by this gate.

-- CreateEnum
CREATE TYPE "AssetVerificationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AssetDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "verificationReason" TEXT,
ADD COLUMN     "verificationReviewedAt" TIMESTAMPTZ(6),
ADD COLUMN     "verificationReviewedByAdminId" UUID,
ADD COLUMN     "verificationStatus" "AssetVerificationStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "verificationSubmittedAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "asset_documents" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "AssetDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewedByAdminId" UUID,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "asset_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_documents_objectKey_key" ON "asset_documents"("objectKey");

-- CreateIndex
CREATE INDEX "asset_documents_status_idx" ON "asset_documents"("status");

-- CreateIndex
CREATE INDEX "asset_documents_reviewedByAdminId_idx" ON "asset_documents"("reviewedByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_documents_assetId_type_key" ON "asset_documents"("assetId", "type");

-- CreateIndex
CREATE INDEX "assets_verificationStatus_idx" ON "assets"("verificationStatus");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_verificationReviewedByAdminId_fkey" FOREIGN KEY ("verificationReviewedByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
