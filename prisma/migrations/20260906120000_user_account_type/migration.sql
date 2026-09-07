-- EXCLUSIVE ACCOUNT TYPES (Gate Z-2) — the DECLARED self-service intent captured
-- during exclusive phone-first registration. Purely ADDITIVE and legacy-safe:
--   * a new Postgres enum type, and
--   * a NULLABLE column on "users" with NO default.
-- A nullable column with no default is added instantly by Postgres (no table rewrite,
-- no lock beyond a brief ACCESS EXCLUSIVE for the catalog change), so every existing
-- row keeps accountType = NULL. There is NO UPDATE / DELETE / backfill here — legacy
-- rows stay NULL and are classified by the Gate Z-1 effective-type resolver.

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CUSTOMER', 'PROVIDER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "accountType" "AccountType";
