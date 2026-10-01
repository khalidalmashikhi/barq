-- Phase 3C — Vehicle Registration Extraction, Slice 2 correction. ADDITIVE ONLY: attempt
-- accounting so a FAILED extraction is retryable/observable and never permanently stuck, and a
-- prior success is distinguishable from a later re-attempt. The NOT NULL DEFAULT 0 on attemptCount
-- is safe (the table is empty everywhere — migration 60 is itself unapplied on staging/production).
-- No change to any existing column, no backfill beyond the column default, no destructive DDL.

-- AlterTable
ALTER TABLE "vehicle_registration_extractions" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastAttemptedAt" TIMESTAMPTZ(6),
ADD COLUMN     "lastSucceededAt" TIMESTAMPTZ(6);

