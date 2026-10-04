-- Phase 3C Slice 3B (durable-cleanup correction) — ADDITIVE ONLY.
-- Introduces a durable, retryable private-object cleanup outbox. No destructive DDL; no change
-- to, or backfill of, any existing table; no default that alters existing behavior.

-- CreateEnum
CREATE TYPE "PrivateObjectCleanupStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "private_object_cleanup_tasks" (
    "id" UUID NOT NULL,
    "objectKey" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "PrivateObjectCleanupStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "private_object_cleanup_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "private_object_cleanup_tasks_objectKey_key" ON "private_object_cleanup_tasks"("objectKey");

-- CreateIndex
CREATE INDEX "private_object_cleanup_tasks_status_nextAttemptAt_idx" ON "private_object_cleanup_tasks"("status", "nextAttemptAt");
