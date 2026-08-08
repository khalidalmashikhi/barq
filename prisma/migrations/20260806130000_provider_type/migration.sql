-- Gap D: Provider type (INDIVIDUAL | COMPANY). Additive and backward-compatible.
-- A NOT NULL column with DEFAULT 'COMPANY' is populated for every existing
-- `providers` row by Postgres at ADD COLUMN time (metadata-only default, PG11+),
-- so all pre-existing providers are classified COMPANY — the safe default, since
-- every provider was created with a REQUIRED businessName under business
-- semantics and no individual concept ever existed. No row rewrite, no data
-- loss, no destructive change; services/bookings/permissions/approvals/
-- ProviderCategory/audit are untouched. The enum is new (no conflict).
CREATE TYPE "ProviderType" AS ENUM ('INDIVIDUAL', 'COMPANY');
ALTER TABLE "providers" ADD COLUMN "providerType" "ProviderType" NOT NULL DEFAULT 'COMPANY';
