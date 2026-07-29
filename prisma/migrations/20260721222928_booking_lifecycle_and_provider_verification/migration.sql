-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
--
-- Split into its own migration (rather than combined with the
-- Provider column changes and CREATED->PENDING_PROVIDER backfill
-- below) because Postgres refuses to use a newly-added enum value
-- inside the same transaction that added it, and Prisma runs each
-- migration.sql in a single transaction.

ALTER TYPE "BookingStatus" ADD VALUE 'PENDING_PROVIDER';
ALTER TYPE "BookingStatus" ADD VALUE 'REJECTED';
