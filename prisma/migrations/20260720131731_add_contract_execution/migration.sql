-- CreateEnum
CREATE TYPE "ContractExecutionStatus" AS ENUM ('PENDING_CUSTOMER', 'CUSTOMER_SIGNED', 'PENDING_PROVIDER', 'PROVIDER_SIGNED', 'EXECUTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ContractSignatureMethod" AS ENUM ('INTERNAL', 'EXTERNAL_PROVIDER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingContractEventType" ADD VALUE 'VIEWED';
ALTER TYPE "BookingContractEventType" ADD VALUE 'CUSTOMER_SIGNED';
ALTER TYPE "BookingContractEventType" ADD VALUE 'PROVIDER_SIGNED';
ALTER TYPE "BookingContractEventType" ADD VALUE 'EXECUTED';

-- CreateTable
CREATE TABLE "contract_executions" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "status" "ContractExecutionStatus" NOT NULL DEFAULT 'PENDING_CUSTOMER',
    "verificationToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contract_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_signatures" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "signerType" "BookingActorType" NOT NULL,
    "signerId" UUID,
    "signedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "method" "ContractSignatureMethod" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "providerReference" TEXT,

    CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_executions_contractId_key" ON "contract_executions"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_executions_verificationToken_key" ON "contract_executions"("verificationToken");

-- CreateIndex
CREATE INDEX "contract_executions_status_idx" ON "contract_executions"("status");

-- CreateIndex
CREATE INDEX "contract_signatures_contractId_idx" ON "contract_signatures"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_signatures_executionId_signerType_key" ON "contract_signatures"("executionId", "signerType");

-- AddForeignKey
ALTER TABLE "contract_executions" ADD CONSTRAINT "contract_executions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "booking_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "booking_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "contract_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
