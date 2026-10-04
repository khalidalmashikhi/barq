-- Phase 3C Slice 3B (upload idempotency) — ADDITIVE ONLY.
-- One nullable column + one unique index on "assets". No existing row is updated or backfilled
-- (the column is NULL for every existing asset; a unique index permits any number of NULLs), no
-- destructive DDL, no default that changes existing behavior.

-- AlterTable
ALTER TABLE "assets" ADD COLUMN "onboardingRequestKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "assets_providerId_onboardingRequestKey_key" ON "assets"("providerId", "onboardingRequestKey");
