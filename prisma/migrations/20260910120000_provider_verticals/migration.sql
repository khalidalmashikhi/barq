-- Phase 3B — Phase 1: Provider Verticals + regulated-offering discriminator (migration 53).
--
-- PURELY ADDITIVE and backward-compatible. No column drop, no data rewrite, no UPDATE, no
-- DELETE, no NOT NULL on existing columns, no status/audit-row change. Existing providers,
-- services, bookings, and their behavior are untouched by this migration itself; the
-- backfill of candidate verticals + legacy-exempt flags is a SEPARATE, idempotent, read-then-
-- write script (never run inside this DDL), and it NEVER auto-approves a regulated vertical.
--
--   • ProviderVerticalType   — the regulated activity a provider may be approved for. Kept
--                              separate from Provider.providerType (INDIVIDUAL|COMPANY = form).
--   • ProviderVerticalStatus — the per-vertical review lifecycle (PENDING_REVIEW default).
--   • ProviderVerticalOrigin — PROVIDER_REQUEST vs LEGACY_BACKFILL (candidate, never approved).
--   • OfferingKind           — Service discriminator; NULLABLE (legacy stays NULL, no TOUR
--                              backfill); a new regulated Service must set a valid kind.
--   • services.legacyVerticalExempt — BOUNDED grandfathering flag (default FALSE, so a new
--                              null-kind service can never bypass the vertical gate).
--   • provider_verticals     — one row per (provider, vertical); the SOLE create/publish
--                              authority for that vertical. History is AuditLog; last reason
--                              kept on the row. FKs: provider CASCADE, reviewer SET NULL.
--
-- Every new enum value is introduced by CREATE TYPE (not ALTER TYPE ADD VALUE), so there is
-- no "new value unusable in the same transaction" constraint here — the whole migration
-- applies atomically under `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "ProviderVerticalType" AS ENUM ('TOURIST_GUIDE', 'RENTAL_COMPANY');

-- CreateEnum
CREATE TYPE "ProviderVerticalStatus" AS ENUM ('PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProviderVerticalOrigin" AS ENUM ('PROVIDER_REQUEST', 'LEGACY_BACKFILL');

-- CreateEnum
CREATE TYPE "OfferingKind" AS ENUM ('TOUR', 'VEHICLE_RENTAL');

-- AlterEnum — add the two provider-vertical audiences to the EXISTING ADR-0017 audience enum.
-- These values are ADDED here but never USED within this migration (no INSERT/UPDATE references
-- them), so the PG "a new enum value cannot be used in the same transaction it is added" rule is
-- not triggered — the migration still applies atomically under `prisma migrate deploy` on PG12+.
ALTER TYPE "VerificationRequirementAudience" ADD VALUE 'TOURIST_GUIDE';
ALTER TYPE "VerificationRequirementAudience" ADD VALUE 'RENTAL_COMPANY';

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "legacyVerticalExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offeringKind" "OfferingKind";

-- AlterTable — compliance (Phase 3B Phase 1). Additive, legacy-safe.
--   • provider_verification_requirements.evidenceExpires — admin-config flag: does this requirement's
--     evidence carry an expiry that must stay valid (default FALSE → existing rows are non-expiring).
--   • provider_documents.expiresAt — the authoritative expiry instant confirmed at approval, mirroring
--     asset_documents.expiresAt. NULLABLE → every existing row and all non-expiring evidence stay null.
ALTER TABLE "provider_verification_requirements" ADD COLUMN     "evidenceExpires" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "provider_documents" ADD COLUMN     "expiresAt" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "provider_verticals" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "vertical" "ProviderVerticalType" NOT NULL,
    "status" "ProviderVerticalStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "origin" "ProviderVerticalOrigin" NOT NULL,
    "reason" TEXT,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewedByAdminId" UUID,
    "suspendedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "provider_verticals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_verticals_status_idx" ON "provider_verticals"("status");

-- CreateIndex
CREATE INDEX "provider_verticals_vertical_status_idx" ON "provider_verticals"("vertical", "status");

-- CreateIndex
CREATE INDEX "provider_verticals_reviewedByAdminId_idx" ON "provider_verticals"("reviewedByAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_verticals_providerId_vertical_key" ON "provider_verticals"("providerId", "vertical");

-- CreateIndex
CREATE INDEX "services_offeringKind_idx" ON "services"("offeringKind");

-- AddForeignKey
ALTER TABLE "provider_verticals" ADD CONSTRAINT "provider_verticals_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verticals" ADD CONSTRAINT "provider_verticals_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
