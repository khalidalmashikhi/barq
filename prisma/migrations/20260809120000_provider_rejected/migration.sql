-- Provider Review / Reject / Resubmit lifecycle (Gate 1: schema only).
-- Additive and backward-compatible; no destructive change, no backfill.
--
-- 1. New ProviderStatus value REJECTED. ADD VALUE only appends to the enum
--    type — it never rewrites existing rows and touches no other value, so
--    every existing provider keeps its current status. (PG12+/Supabase runs
--    this safely; the value is only added here, never used in this migration.)
-- 2. Three NULLABLE rejection columns on providers, mirroring the existing
--    approvedAt/approvedByAdminId design. Nullable with no default → existing
--    rows get NULL at ADD COLUMN time (metadata-only, no row rewrite); a
--    provider only ever has them set while currently REJECTED (cleared on
--    resubmit). rejectionReason is TEXT (Prisma String).
-- 3. Index + FK on rejectedByAdminId mirror providers_approvedByAdminId_idx and
--    the ProviderApprovedBy foreign key exactly (ON DELETE SET NULL: losing an
--    admin must never delete a provider, only null the reference).
-- Services/bookings/approvals/visibility/audit are untouched.

-- AlterEnum
ALTER TYPE "ProviderStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "rejectedAt" TIMESTAMPTZ(6),
ADD COLUMN     "rejectedByAdminId" UUID,
ADD COLUMN     "rejectionReason" TEXT;

-- CreateIndex
CREATE INDEX "providers_rejectedByAdminId_idx" ON "providers"("rejectedByAdminId");

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_rejectedByAdminId_fkey" FOREIGN KEY ("rejectedByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
