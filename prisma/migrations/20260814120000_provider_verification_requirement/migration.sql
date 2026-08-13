-- Configurable Provider Verification Requirements — ADR-0017 (Level 2), SCHEMA
-- gate only. Purely ADDITIVE and safe: one new enum + one new table + its two
-- indexes. No change to any existing table/column, no data rewrite, no backfill,
-- no drop/rename, and no booking / pricing / payment / auth / provider-document
-- change. Existing `provider_documents` rows are UNTOUCHED and remain valid —
-- their `type` String continues to reference a requirement `key` (a soft
-- reference, never a relational FK), so no ProviderDocument is orphaned.
--
-- Enforcement (BR-029) stays code-controlled: this table decides WHICH documents
-- are required; assertProviderApprovable() decides WHETHER approval is allowed and
-- always runs. A config/DB read failure fails CLOSED to the code-default required
-- set (src/lib/provider-document-types/policy.ts), never "require nothing".
--
-- The default policy rows (IDENTITY_PROOF/INDIVIDUAL/required,
-- COMMERCIAL_REGISTRATION/COMPANY/required, TOURISM_LICENCE/BOTH/optional) are
-- NOT seeded in this migration — seeding is a later, APP_ENV=staging-guarded
-- bootstrap step (same convention as the ADR-0016 taxonomy), not an in-migration
-- data write. This gate creates the structure only.

-- CreateEnum
CREATE TYPE "VerificationRequirementAudience" AS ENUM ('INDIVIDUAL', 'COMPANY', 'BOTH');

-- CreateTable
CREATE TABLE "provider_verification_requirements" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "description" JSONB,
    "appliesTo" "VerificationRequirementAudience" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "provider_verification_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_verification_requirements_key_key" ON "provider_verification_requirements"("key");

-- CreateIndex
CREATE INDEX "provider_verification_requirements_active_idx" ON "provider_verification_requirements"("active");
