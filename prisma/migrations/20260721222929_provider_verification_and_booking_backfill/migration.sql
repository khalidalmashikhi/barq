-- AlterTable
ALTER TABLE "providers" ADD COLUMN     "approvedAt" TIMESTAMPTZ(6),
ADD COLUMN     "approvedByAdminId" UUID;

-- CreateIndex
CREATE INDEX "providers_approvedByAdminId_idx" ON "providers"("approvedByAdminId");

-- AddForeignKey
ALTER TABLE "providers" ADD CONSTRAINT "providers_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data backfill: CREATED becomes a momentary status that immediately
-- auto-advances to PENDING_PROVIDER (see create-booking.ts). Any booking
-- left at plain CREATED today would otherwise be invisible to the new
-- provider "needs action" queue. Not a real transition anyone performed,
-- so no BookingStatusEvent row is fabricated for it.
UPDATE "bookings" SET "status" = 'PENDING_PROVIDER' WHERE "status" = 'CREATED';
