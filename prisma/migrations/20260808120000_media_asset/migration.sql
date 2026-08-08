-- Media Foundation (Gap C). Additive and non-destructive.
--
-- Adds two enums + one new table (media_assets) holding POINTERS to objects
-- stored in Supabase Storage — no binary in Postgres. Ownership is
-- FK-backed to providers/services with ON DELETE CASCADE, so deleting an
-- owner removes its media rows automatically (storage-object cleanup is
-- handled in application code). Exactly one of providerId/serviceId is set
-- per row (enforced in application code).
--
-- NOTHING EXISTING IS ALTERED: no table/column/row is dropped or changed.
-- providers.logoUrl is untouched and keeps working; media_assets becomes the
-- new source of truth for provider logos while also keeping logoUrl
-- populated, so every existing read path (public profile, OG image, admin)
-- continues to render with zero changes.

-- CreateEnum
CREATE TYPE "MediaOwnerType" AS ENUM ('PROVIDER', 'SERVICE');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('LOGO', 'COVER', 'PORTFOLIO', 'GALLERY');

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "ownerType" "MediaOwnerType" NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "providerId" UUID,
    "serviceId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_objectKey_key" ON "media_assets"("objectKey");

-- CreateIndex
CREATE INDEX "media_assets_providerId_kind_idx" ON "media_assets"("providerId", "kind");

-- CreateIndex
CREATE INDEX "media_assets_serviceId_kind_idx" ON "media_assets"("serviceId", "kind");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
