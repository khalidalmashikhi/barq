-- Gate B1 — Migration 2 of 2: deterministic, non-destructive backfill of
-- ProviderCategory provenance, then finalize the column and the primary
-- constraint. No row is deleted; no ADMIN attribution is fabricated.
--
-- Order (Gate B amendments 1 & 2):
--   1. Elect exactly one primary per provider (oldest createdAt, categoryId
--      tiebreak) -> source = SELF, isPrimary = true.
--   2. Every other pre-existing row -> source = LEGACY (NOT ADMIN),
--      isPrimary = false, no admin attribution.
--   3. Verify no NULL source remains (abort the migration if any does).
--   4. ALTER source SET NOT NULL (final column: NOT NULL, and — because no
--      DEFAULT was ever added — NO database default).
--   5. Create the PARTIAL UNIQUE INDEX: AT MOST ONE primary per provider.
--      ("At least one" for a new provider is a domain invariant, not this index.)

-- 1. Elect the single primary per provider (deterministic).
WITH ranked AS (
  SELECT "providerId", "categoryId",
         ROW_NUMBER() OVER (
           PARTITION BY "providerId"
           ORDER BY "createdAt" ASC, "categoryId" ASC
         ) AS rn
  FROM "provider_categories"
)
UPDATE "provider_categories" pc
SET "isPrimary" = true, "source" = 'SELF'
FROM ranked r
WHERE pc."providerId" = r."providerId"
  AND pc."categoryId" = r."categoryId"
  AND r.rn = 1;

-- 2. Every remaining (unclassified) pre-existing row becomes LEGACY.
UPDATE "provider_categories"
SET "source" = 'LEGACY', "isPrimary" = false,
    "grantedByAdminId" = NULL, "grantedAt" = NULL
WHERE "source" IS NULL;

-- 3. Safety gate: no row may be left without provenance.
DO $$
DECLARE null_count integer;
BEGIN
  SELECT count(*) INTO null_count FROM "provider_categories" WHERE "source" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'Gate B1 backfill incomplete: % provider_categories rows still have NULL source', null_count;
  END IF;
END $$;

-- 4. Finalize the column: NOT NULL, no database default.
ALTER TABLE "provider_categories" ALTER COLUMN "source" SET NOT NULL;

-- 5. Enforce AT MOST ONE primary activity per provider at the DB level.
CREATE UNIQUE INDEX "provider_categories_one_primary"
  ON "provider_categories" ("providerId")
  WHERE "isPrimary";
