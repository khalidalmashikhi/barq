-- Gate B1 — Migration 1 of 2: additive schema for in-app notification events
-- and ProviderCategory provenance. Purely additive; no data change here.
--
-- `source` is added NULLABLE on purpose: Migration 2 backfills every existing
-- ProviderCategory row deterministically, verifies no NULL remains, then
-- SET NOT NULL. The final column is NOT NULL with NO database default (Gate B
-- amendment 1 — provenance must always be written explicitly by runtime code).
--
-- `ALTER TYPE ... ADD VALUE 'IN_APP'` is safe in this migration: the new value
-- is NOT used by any statement here (same inline pattern already shipped for
-- ProviderStatus DRAFT / CHANGES_REQUESTED on Supabase / PostgreSQL 15).

-- CreateEnum
CREATE TYPE "ProviderCategorySource" AS ENUM ('SELF', 'ADMIN', 'LEGACY');

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'IN_APP';

-- AlterTable
ALTER TABLE "provider_categories" ADD COLUMN     "grantedAt" TIMESTAMPTZ(6),
ADD COLUMN     "grantedByAdminId" UUID,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "ProviderCategorySource";

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "entityId" UUID,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "eventType" TEXT;

-- CreateIndex
CREATE INDEX "provider_categories_providerId_isPrimary_idx" ON "provider_categories"("providerId", "isPrimary");

-- CreateIndex
CREATE INDEX "notifications_entityType_entityId_idx" ON "notifications"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "provider_categories" ADD CONSTRAINT "provider_categories_grantedByAdminId_fkey" FOREIGN KEY ("grantedByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
