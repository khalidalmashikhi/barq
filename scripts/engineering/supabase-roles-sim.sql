-- DISPOSABLE-DATABASE ONLY. Reproduces Supabase's role layout and its default grants on `public`
-- so src/lib/security/data-api-roles.dbproof.test.ts can prove the exposure exists BEFORE the
-- security migration and is gone AFTER it. Run as a superuser (the disposable container's
-- POSTGRES_USER) on a freshly created database; never against staging or production.
-- Mirrors Supabase: `postgres` is a NON-superuser that owns the database and creates every BARQ
-- object (Prisma migrations + the app); `supabase_admin` is the platform superuser.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon          NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role  NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN SUPERUSER; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres LOGIN PASSWORD 'dbproof' CREATEDB CREATEROLE NOSUPERUSER;
  END IF;
END $$;

-- the creating role owns the database and the schema, as on Supabase
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I OWNER TO postgres', current_database()); END $$;
ALTER SCHEMA public OWNER TO postgres;

-- Supabase's grants on the schema
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO anon, authenticated, service_role;

-- Supabase's DANGEROUS defaults: every future object in public is granted to the API roles
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
