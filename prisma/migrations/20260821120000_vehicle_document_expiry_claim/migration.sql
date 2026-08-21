-- VEHICLE-LC6 — provider-claimed expiry date (advisory) on asset documents.
--
-- Additive, nullable, legacy-safe: existing rows keep NULL (no claim). The TRUSTED
-- expiry stays "expiresAt" (admin-confirmed instant); this column only records what
-- the provider stated, for the admin to verify/correct at approval. No backfill.
ALTER TABLE "asset_documents" ADD COLUMN "claimedExpiryDate" TEXT;
