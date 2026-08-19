import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// VEHICLE-LC1 — pin the AssetDocument schema DECISIONS that a unit test can't
// exercise against a live DB, by asserting the committed migration SQL. These
// guarantee: ownership is inherited via assetId (NOT a denormalized providerId),
// uniqueness is PER-ASSET (so multiple vehicles of one provider each hold the same
// document type — the whole reason ProviderDocument was not reused), the private
// objectKey is stored + unique, and expiry is a nullable column.
const SQL = readFileSync(
  "prisma/migrations/20260820120000_vehicle_verification_lifecycle/migration.sql",
  "utf8",
);

describe("asset_documents migration — ownership + uniqueness decisions", () => {
  it("creates asset_documents with an assetId FK to assets (ownership inherited)", () => {
    expect(SQL).toContain('CREATE TABLE "asset_documents"');
    expect(SQL).toContain('"assetId" UUID NOT NULL');
    expect(SQL).toMatch(/asset_documents_assetId_fkey.*REFERENCES "assets"\("id"\) ON DELETE CASCADE/s);
  });

  it("uniqueness is PER-ASSET (assetId, type) — NOT per-provider", () => {
    expect(SQL).toContain('CREATE UNIQUE INDEX "asset_documents_assetId_type_key" ON "asset_documents"("assetId", "type")');
    // No denormalized providerId column and no (providerId, type) unique on this table.
    expect(SQL).not.toMatch(/asset_documents[\s\S]*"providerId"/);
  });

  it("stores a PRIVATE, unique objectKey (never a public/signed URL column)", () => {
    expect(SQL).toContain('"objectKey" TEXT NOT NULL');
    expect(SQL).toContain('CREATE UNIQUE INDEX "asset_documents_objectKey_key"');
    expect(SQL).not.toMatch(/asset_documents[\s\S]*"(url|signedUrl|publicUrl)"/i);
  });

  it("has a nullable expiresAt column (computed expiry, no cron)", () => {
    expect(SQL).toContain('"expiresAt" TIMESTAMPTZ(6)');
    expect(SQL).not.toMatch(/"expiresAt" TIMESTAMPTZ\(6\) NOT NULL/);
  });
});

describe("assets verification columns — fail-closed default", () => {
  it("adds verificationStatus NOT NULL DEFAULT 'DRAFT' (legacy rows land fail-closed)", () => {
    expect(SQL).toContain(`"verificationStatus" "AssetVerificationStatus" NOT NULL DEFAULT 'DRAFT'`);
    // Never activates or approves any existing row.
    expect(SQL).not.toMatch(/UPDATE "assets"/);
    expect(SQL).not.toMatch(/DEFAULT 'APPROVED'/);
    expect(SQL).not.toMatch(/DEFAULT 'ACTIVE'/);
  });

  it("is purely additive — no destructive ops, no AssetStatus value change", () => {
    for (const forbidden of ["DROP TABLE", "DROP COLUMN", "DELETE FROM", "TRUNCATE", "ALTER TYPE \"AssetStatus\""]) {
      expect(SQL).not.toContain(forbidden);
    }
  });
});
