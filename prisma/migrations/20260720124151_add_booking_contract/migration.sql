-- Contract Number sequence (requirement #3: sequential, human-readable,
-- guaranteed no duplicates). Not expressible in Prisma's schema DSL
-- (which only supports autoincrement() on an Int primary key, not a
-- custom-formatted string column) — a plain Postgres sequence is the
-- standard, concurrency-safe primitive for this, called via
-- `SELECT nextval(...)` from src/lib/contracts/contract-number.ts and
-- formatted there into e.g. "BARQ-2026-000123". A rolled-back
-- transaction "burns" a number (the sequence advances regardless of
-- transaction outcome) — normal, accepted behavior for a human-readable
-- reference number, same as invoice/order numbering in most systems.
CREATE SEQUENCE "booking_contract_number_seq" START WITH 1;

-- CreateEnum
CREATE TYPE "BookingContractStatus" AS ENUM ('DRAFT', 'GENERATED', 'ISSUED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookingContractEventType" AS ENUM ('CREATED', 'GENERATED', 'ISSUED', 'ACTIVATED', 'DOWNLOADED', 'ARCHIVED', 'CANCELLED', 'COMPLETED', 'EXPIRED', 'SIGNED');

-- CreateTable
CREATE TABLE "booking_contracts" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "status" "BookingContractStatus" NOT NULL DEFAULT 'DRAFT',
    "templateKey" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "content" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMPTZ(6),
    "generatedByActorType" "BookingActorType",
    "generatedByActorId" UUID,
    "generatedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "supersedesContractId" UUID,

    CONSTRAINT "booking_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_contract_events" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "eventType" "BookingContractEventType" NOT NULL,
    "actorType" "BookingActorType" NOT NULL,
    "actorId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_contract_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_contracts_contractNumber_key" ON "booking_contracts"("contractNumber");

-- CreateIndex
CREATE UNIQUE INDEX "booking_contracts_supersedesContractId_key" ON "booking_contracts"("supersedesContractId");

-- CreateIndex
CREATE INDEX "booking_contracts_bookingId_idx" ON "booking_contracts"("bookingId");

-- CreateIndex
CREATE INDEX "booking_contracts_status_idx" ON "booking_contracts"("status");

-- CreateIndex
CREATE INDEX "booking_contract_events_contractId_createdAt_idx" ON "booking_contract_events"("contractId", "createdAt");

-- AddForeignKey
ALTER TABLE "booking_contracts" ADD CONSTRAINT "booking_contracts_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_contracts" ADD CONSTRAINT "booking_contracts_supersedesContractId_fkey" FOREIGN KEY ("supersedesContractId") REFERENCES "booking_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_contract_events" ADD CONSTRAINT "booking_contract_events_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "booking_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
