-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "booking_email_deliveries" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "recipientUserId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_email_deliveries_status_createdAt_idx" ON "booking_email_deliveries"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "booking_email_deliveries_bookingId_kind_recipientUserId_key" ON "booking_email_deliveries"("bookingId", "kind", "recipientUserId");

-- AddForeignKey
ALTER TABLE "booking_email_deliveries" ADD CONSTRAINT "booking_email_deliveries_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_email_deliveries" ADD CONSTRAINT "booking_email_deliveries_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

