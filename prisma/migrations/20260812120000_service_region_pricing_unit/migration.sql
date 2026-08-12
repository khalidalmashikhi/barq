-- Core Service enrichment — Gate 2 (schema + migration ONLY). Purely additive
-- and safe: two NULLABLE columns + one index + one governed-value CHECK
-- constraint. No backfill, no data rewrite, no drop/rename, no default, and no
-- booking / pricing / payment / availability change. Existing rows stay valid:
-- services."regionCode" = NULL and prices."pricingUnit" = NULL, preserving current
-- rendering and business behavior until Gate 3/4 wire these fields.

-- 1. Service.regionCode — the broad Oman governorate where a service operates
--    (discovery). A stable governorate CODE (e.g. DHOFAR), never free-text or a
--    localized name.
ALTER TABLE "services" ADD COLUMN "regionCode" TEXT;

-- 2. Price.pricingUnit — the commercial/display basis of `amount`. DISPLAY
--    METADATA ONLY this milestone (never affects totals / seats / days / payment
--    / price snapshots).
ALTER TABLE "prices" ADD COLUMN "pricingUnit" TEXT;

-- 3. Index for the upcoming regionCode Explore filter (Gate 4). pricingUnit is
--    not a customer filter, so it gets no index.
CREATE INDEX "services_regionCode_idx" ON "services"("regionCode");

-- 4. Governed-value CHECK constraint on regionCode ONLY — the DB-level second
--    line of defense, mirroring the categories_serviceTypeKey_check convention
--    (a Prisma enum is deliberately not used, same rationale). The Oman
--    governorate set is stable, so a CHECK is a sound defense-in-depth here; it
--    must stay in sync with the Gate-3 src/lib/regions registry (enforced by that
--    file's own test). A NULL value passes the CHECK (unknown), so every existing
--    row remains valid without any backfill.
--
--    NOTE: pricingUnit deliberately has NO DB CHECK — its vocabulary is
--    commercially extensible (PER_NIGHT / PER_VEHICLE / PER_ITEM / PER_PACKAGE as
--    specialization lands), so a CHECK would force a migration per addition. The
--    Gate-3 code registry (src/lib/pricing-units) is the authoritative allow-list.
ALTER TABLE "services"
  ADD CONSTRAINT "services_regionCode_check"
  CHECK ("regionCode" IN (
    'MUSCAT', 'DHOFAR', 'MUSANDAM', 'AL_BURAIMI', 'AD_DAKHILIYAH',
    'AL_BATINAH_NORTH', 'AL_BATINAH_SOUTH', 'ASH_SHARQIYAH_NORTH',
    'ASH_SHARQIYAH_SOUTH', 'ADH_DHAHIRAH', 'AL_WUSTA'
  ));
