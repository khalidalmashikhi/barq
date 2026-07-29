-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "readAt" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");
