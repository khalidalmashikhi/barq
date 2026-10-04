-- Phase 3C Slice 3B (durable onboarding-request authority) — ADDITIVE ONLY.
-- One new enum + one new table + its indexes and foreign keys. No existing table, column, index
-- or row is altered; nothing is backfilled. The table is the idempotency authority for
-- document-first vehicle onboarding and deliberately OUTLIVES the asset it produced:
-- "assetId" is SET NULL when that asset is deleted, so the row remains as a tombstone.

-- CreateEnum
CREATE TYPE "VehicleOnboardingRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "vehicle_onboarding_requests" (
    "id" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "VehicleOnboardingRequestStatus" NOT NULL DEFAULT 'PENDING',
    "assetId" UUID,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicle_onboarding_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_onboarding_requests_assetId_key" ON "vehicle_onboarding_requests"("assetId");

-- CreateIndex
CREATE INDEX "vehicle_onboarding_requests_expiresAt_idx" ON "vehicle_onboarding_requests"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_onboarding_requests_providerId_idempotencyKey_key" ON "vehicle_onboarding_requests"("providerId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "vehicle_onboarding_requests" ADD CONSTRAINT "vehicle_onboarding_requests_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_onboarding_requests" ADD CONSTRAINT "vehicle_onboarding_requests_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
