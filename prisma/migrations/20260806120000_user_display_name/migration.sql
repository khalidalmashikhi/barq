-- Finish-Line: Customer Profile — add an optional self-editable display name to
-- the identity User. Additive and backward-compatible: the column is NULLABLE
-- with no default, so every existing `users` row keeps NULL and no data is
-- rewritten. Application reads fall back to a masked phone when name IS NULL.
-- One name on the identity record, reused by every role (never duplicated onto
-- customers/providers). Non-destructive; no backfill required.
ALTER TABLE "users" ADD COLUMN "name" TEXT;
