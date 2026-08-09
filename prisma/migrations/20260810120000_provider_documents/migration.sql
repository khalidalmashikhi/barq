-- Provider Verification & Documents (Gate 1: schema/domain contract only).
-- Purely additive and backward-compatible; no destructive change, no backfill,
-- no mutation of any existing row, no change to ProviderStatus or any existing
-- table.
--
-- 1. New ProviderDocumentStatus enum (fixed 3-state per-document review
--    lifecycle). CREATE TYPE only — touches no existing type or row.
-- 2. New provider_documents table. `type` is a plain TEXT column (a
--    registry-validated stable key, src/lib/provider-document-types) — NOT a
--    Prisma enum and NOT a DB CHECK, so adding a document type later needs no
--    migration. `objectKey` is the PRIVATE storage object key ONLY — there is no
--    public/permanent/signed URL column, by design.
-- 3. objectKey is globally unique; (providerId, type) is unique (one current
--    document per provider per type; replace = upsert). The (providerId, type)
--    unique index also serves providerId-prefix lookups, so no separate
--    providerId index is created (same reasoning as MediaAsset).
-- 4. providerId FK ON DELETE CASCADE — deleting a provider removes its
--    documents. reviewedByAdminId FK ON DELETE SET NULL — deleting an admin
--    reviewer nulls the reference, never deletes the document (mirrors the
--    existing approvedByAdmin/rejectedByAdmin foreign keys).
-- Existing providers/services/bookings/approvals/visibility are untouched.

-- CreateEnum
CREATE TYPE "ProviderDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "provider_documents" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "ProviderDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewedByAdminId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "provider_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_documents_objectKey_key" ON "provider_documents"("objectKey");

-- CreateIndex
CREATE INDEX "provider_documents_status_idx" ON "provider_documents"("status");

-- CreateIndex
CREATE INDEX "provider_documents_reviewedByAdminId_idx" ON "provider_documents"("reviewedByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_documents_providerId_type_key" ON "provider_documents"("providerId", "type");

-- AddForeignKey
ALTER TABLE "provider_documents" ADD CONSTRAINT "provider_documents_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_documents" ADD CONSTRAINT "provider_documents_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
