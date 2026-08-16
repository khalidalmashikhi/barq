-- Gate 1B — admin "Request Changes" outcome (distinct from REJECTED).
-- Additive / non-destructive: adds the CHANGES_REQUESTED status value only.
-- No existing Provider.status value changes; no new column (the changes reason
-- reuses the existing rejectionReason field). The new enum value is NOT used in
-- this migration, so ADD VALUE is safe inside the migration transaction (PG 12+).

-- AlterEnum
ALTER TYPE "ProviderStatus" ADD VALUE 'CHANGES_REQUESTED';
