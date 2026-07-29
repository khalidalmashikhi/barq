-- CreateEnum
CREATE TYPE "CategoryVisibilityStatus" AS ENUM ('PUBLIC', 'HIDDEN', 'LINK_ONLY', 'INVITE_ONLY', 'SCHEDULED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "slug" TEXT NOT NULL,
    "visibilityStatus" "CategoryVisibilityStatus" NOT NULL DEFAULT 'HIDDEN',
    "scheduledVisibleAt" TIMESTAMPTZ(6),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_categories" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "slug" TEXT NOT NULL,
    "visibilityStatus" "CategoryVisibilityStatus" NOT NULL DEFAULT 'HIDDEN',
    "scheduledVisibleAt" TIMESTAMPTZ(6),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sub_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_visibilityStatus_idx" ON "categories"("visibilityStatus");

-- CreateIndex
CREATE UNIQUE INDEX "sub_categories_slug_key" ON "sub_categories"("slug");

-- CreateIndex
CREATE INDEX "sub_categories_categoryId_idx" ON "sub_categories"("categoryId");

-- CreateIndex
CREATE INDEX "sub_categories_visibilityStatus_idx" ON "sub_categories"("visibilityStatus");

-- AddForeignKey
ALTER TABLE "sub_categories" ADD CONSTRAINT "sub_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
