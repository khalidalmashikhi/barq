-- Smart Tour-Guide Template — config-persistence FOUNDATION (additive only).
--
-- Four NEW admin-governed configuration tables. PURELY ADDITIVE: no ALTER, no
-- DROP, no change to any existing table, no data backfill. Existing services
-- stay valid; Experience.guidingContent (which already exists, nullable) is the
-- home for per-service tour DATA and is untouched here.
--
-- Convention: String key/code (no Prisma enum, validated by the app registry),
-- bilingual { ar, en } JSONB presentation, enabled/visible + sortOrder — the
-- ProviderVerificationRequirement / FeatureFlag / HomepageSection precedent.
-- Behavioural semantics (package→vehicle requirements, FOUR_BY_FOUR) are owned
-- by application code keyed off `key`/`code`, never stored here.

-- CreateTable
CREATE TABLE "tour_package_presets" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" JSONB NOT NULL,
    "description" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tour_package_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_template_texts" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tour_template_texts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_vehicle_type_options" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tour_vehicle_type_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_template_field_rules" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" JSONB,
    "helpText" JSONB,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tour_template_field_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tour_package_presets_key_key" ON "tour_package_presets"("key");

-- CreateIndex
CREATE INDEX "tour_package_presets_enabled_idx" ON "tour_package_presets"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "tour_template_texts_key_key" ON "tour_template_texts"("key");

-- CreateIndex
CREATE INDEX "tour_template_texts_enabled_idx" ON "tour_template_texts"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "tour_vehicle_type_options_code_key" ON "tour_vehicle_type_options"("code");

-- CreateIndex
CREATE INDEX "tour_vehicle_type_options_enabled_idx" ON "tour_vehicle_type_options"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "tour_template_field_rules_key_key" ON "tour_template_field_rules"("key");

-- CreateIndex
CREATE INDEX "tour_template_field_rules_visible_idx" ON "tour_template_field_rules"("visible");

