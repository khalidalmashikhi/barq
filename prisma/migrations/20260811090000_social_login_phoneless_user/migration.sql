-- Social Login (Gate 1: schema/domain foundation only).
-- Purely additive and backward-compatible. No data migration/backfill, no
-- Account rewrite, no Provider/Admin/Customer reassignment, no auth/session
-- change, no destructive SQL. Existing phone users are untouched.
--
-- 1. users.phoneNumber becomes NULLABLE so a Google/Apple-first BARQ user can
--    exist with no phone yet (a verified phone is required later, at booking /
--    become-provider, NOT at social signup). The existing UNIQUE index
--    (users_phoneNumber_key) is unchanged and still enforced: PostgreSQL treats
--    NULLs as distinct, so multiple phone-less users are permitted while every
--    non-null phone number remains unique.
-- 2. auth_users.image is added (nullable) purely to satisfy Better Auth
--    1.6.23's own expected user schema — its default social profile mapping
--    sets `image: profile.picture`, and its Prisma adapter writes declared user
--    fields, so a Google sign-in would otherwise fail writing this column. No
--    BARQ product surface reads it (Anti-Corruption-Layer boundary).

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "phoneNumber" DROP NOT NULL;

-- AlterTable
ALTER TABLE "auth_users" ADD COLUMN     "image" TEXT;
