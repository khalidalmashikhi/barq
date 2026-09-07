-- STAFF RBAC (Gate Z-3 Part 2). Additive enum value only: allow AuditLog (and the other
-- BookingActorType consumers) to attribute an internal Staff actor to STAFF with
-- actorId = Staff.id, instead of falsely recording it as ADMIN. No backfill, no UPDATE, no
-- DELETE, no status/audit-row rewrite. Existing rows and their attribution are unchanged.
--
-- Postgres note: `ALTER TYPE ... ADD VALUE` is not transactional and the new value is not
-- usable in the same transaction it is added in. This migration contains ONLY the ADD VALUE
-- (no statement in this file uses the value), so `prisma migrate deploy` applies it cleanly.

-- AlterEnum
ALTER TYPE "BookingActorType" ADD VALUE 'STAFF';
