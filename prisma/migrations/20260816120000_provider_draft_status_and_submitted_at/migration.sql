-- Gate 1A — explicit provider verification submission workflow.
-- Additive / non-destructive only: adds the DRAFT status value and the
-- nullable submittedAt column. No existing Provider.status value is changed;
-- legacy APPLIED providers remain APPLIED and reviewable. The new enum value is
-- NOT referenced in this migration (no default/data uses it), so ADD VALUE is
-- safe inside the migration transaction on PostgreSQL 12+.

-- AlterEnum
ALTER TYPE "ProviderStatus" ADD VALUE 'DRAFT';

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "submittedAt" TIMESTAMPTZ(6);
