-- STAFF RBAC + OWNER ADMINISTRATION (Gate Z-3). Purely ADDITIVE and legacy-safe:
--   * a new AdminLevel enum,
--   * Admin.level NOT NULL DEFAULT 'ADMIN' (every existing admin becomes ADMIN; the one
--     OWNER is promoted by a SEPARATE, explicit, owner-confirmed operation — NOT here),
--   * Staff.permissions TEXT[] NOT NULL DEFAULT '{}' (every existing staff = ZERO access
--     until the OWNER grants a preset/permissions),
--   * Staff.invitedByAdminId nullable FK -> admins(id) ON DELETE SET NULL + index.
-- NOT-NULL-with-default columns are added instantly by Postgres (no table rewrite). There
-- is NO UPDATE/DELETE, NO permission backfill, NO OWNER backfill, and NO Customer/Provider
-- or Staff.roles mutation. Staff.roles is retained unchanged (legacy/history only).

-- CreateEnum
CREATE TYPE "AdminLevel" AS ENUM ('OWNER', 'ADMIN');

-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "level" "AdminLevel" NOT NULL DEFAULT 'ADMIN';

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "invitedByAdminId" UUID;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_invitedByAdminId_fkey" FOREIGN KEY ("invitedByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "staff_invitedByAdminId_idx" ON "staff"("invitedByAdminId");
