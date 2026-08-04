-- Taxonomy v2 — P1 EXPAND migration (ADR-0015).
--
-- EXPAND ONLY. Additive columns/tables + a guarded data-copy of every
-- sub_categories row into categories (as a depth-1 child). It deliberately
-- does NOT drop sub_categories: that table is kept as an unread shadow/backup
-- and is dropped only by a later, verified CONTRACT migration
-- (expand/contract). Runs as one transaction (Prisma wraps each migration),
-- so any guard RAISE below rolls the whole thing back — nothing is left half
-- migrated.

-- 1. Category tree + vertical-classification columns (nullable first so the
--    backfill can run before NOT NULL is enforced).
ALTER TABLE "categories" ADD COLUMN "parentId" UUID;
ALTER TABLE "categories" ADD COLUMN "depth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "categories" ADD COLUMN "serviceTypeKey" TEXT;

-- 2. Backfill existing (top-level) categories. serviceTypeKey defaults to
--    EXPERIENCE (the only vertical with behavior today); depth 0; parentId
--    stays NULL. Report how many rows were defaulted so an admin can
--    reclassify any that were meant to be another vertical.
DO $$
DECLARE defaulted INTEGER;
BEGIN
  UPDATE "categories" SET "serviceTypeKey" = 'EXPERIENCE' WHERE "serviceTypeKey" IS NULL;
  GET DIAGNOSTICS defaulted = ROW_COUNT;
  RAISE NOTICE 'taxonomy_v1_expand: defaulted serviceTypeKey=EXPERIENCE on % existing category row(s)', defaulted;
END $$;

-- 3. Guarded data-copy: sub_categories -> categories as depth-1 children.
--    IDs are preserved (nothing FK-references sub_category ids), so guard
--    against id/slug collisions before inserting.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "categories" c JOIN "sub_categories" s ON c."id" = s."id") THEN
    RAISE EXCEPTION 'taxonomy_v1_expand: id collision between categories and sub_categories — aborting';
  END IF;
  IF EXISTS (SELECT 1 FROM "categories" c JOIN "sub_categories" s ON c."slug" = s."slug") THEN
    RAISE EXCEPTION 'taxonomy_v1_expand: slug collision between categories and sub_categories — resolve manually before migrating';
  END IF;
END $$;

INSERT INTO "categories"
  ("id", "name", "slug", "parentId", "depth", "serviceTypeKey",
   "visibilityStatus", "scheduledVisibleAt", "sortOrder", "createdAt", "updatedAt")
SELECT
  s."id", s."name", s."slug", s."categoryId", 1,
  COALESCE(p."serviceTypeKey", 'EXPERIENCE'),
  s."visibilityStatus", s."scheduledVisibleAt", s."sortOrder", s."createdAt", s."updatedAt"
FROM "sub_categories" s
JOIN "categories" p ON p."id" = s."categoryId";

-- Row-count reconciliation: every sub_category must have become a child.
DO $$
DECLARE sub_count INTEGER; child_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO sub_count FROM "sub_categories";
  SELECT COUNT(*) INTO child_count FROM "categories" WHERE "depth" = 1;
  IF sub_count <> child_count THEN
    RAISE EXCEPTION 'taxonomy_v1_expand: row-count mismatch — sub_categories=% but depth-1 categories=% (orphan sub-category?)', sub_count, child_count;
  END IF;
END $$;

-- 4. Enforce integrity now that every row has a value.
ALTER TABLE "categories" ALTER COLUMN "serviceTypeKey" SET NOT NULL;

-- Governed-vertical CHECK constraint (must stay in sync with
-- src/lib/service-types/registry.ts — enforced by that file's own test). This
-- is the DB-level second line of defense; a Prisma enum is deliberately not
-- used (see ADR-0015 / the schema comment on serviceTypeKey).
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_serviceTypeKey_check"
  CHECK ("serviceTypeKey" IN ('EXPERIENCE', 'TRANSPORT', 'ACCOMMODATION', 'DINING', 'EVENT', 'RENTAL'));

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");
CREATE INDEX "categories_serviceTypeKey_idx" ON "categories"("serviceTypeKey");

-- 5. provider_categories (M:N provider "areas of activity"). No isPrimary in
--    P1 (ADR-0015 / BR-025).
CREATE TABLE "provider_categories" (
  "providerId" UUID NOT NULL,
  "categoryId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_categories_pkey" PRIMARY KEY ("providerId", "categoryId")
);
CREATE INDEX "provider_categories_categoryId_idx" ON "provider_categories"("categoryId");
ALTER TABLE "provider_categories"
  ADD CONSTRAINT "provider_categories_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_categories"
  ADD CONSTRAINT "provider_categories_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Service.categoryId — single nullable FK to the most-specific node,
--    onDelete RESTRICT. Nullable indefinitely; publish-time enforcement is
--    P4 (ADR-0015 / BR-026). Existing services stay categoryId = NULL.
ALTER TABLE "services" ADD COLUMN "categoryId" UUID;
CREATE INDEX "services_categoryId_idx" ON "services"("categoryId");
ALTER TABLE "services"
  ADD CONSTRAINT "services_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- NOTE: "sub_categories" is intentionally NOT dropped here (expand/contract).
-- A later, verified contract migration drops it once the tree is confirmed.
