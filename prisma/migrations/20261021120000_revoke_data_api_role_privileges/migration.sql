-- Security fix (incident 2026-10-21): close the application schema to Supabase's Data-API roles.
--
-- Audit of barq-staging (read-only, has_*_privilege): `anon` and `authenticated` held USAGE on
-- `public` and SELECT / INSERT / UPDATE / DELETE / TRUNCATE on all 70 tables, granted by Supabase's
-- default privileges for the role that creates our objects. BARQ never uses the Data API: Prisma
-- (Better Auth included) connects as the table-owning role, and Storage uses its own schema with the
-- service role. So these grants serve no legitimate path.
--
-- PRIVILEGES ONLY. No table, column, index, sequence value or row changes. RLS is NOT enabled here
-- (separate, later phase). `service_role` is deliberately untouched (Storage path). Every
-- Supabase-specific role is optional: on plain PostgreSQL (CI, local) the role blocks are skipped.
-- Idempotent: re-running revokes nothing new and raises nothing.

DO $$
DECLARE
  target  text;
  creator text;
BEGIN
  FOREACH target IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = target);

    -- existing objects
    EXECUTE format('REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM %I', target);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', target);
    EXECUTE format('REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM %I', target);
    EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', target);

    -- future objects: the default privileges of every role that creates objects in `public`
    -- (the migrating role, and Supabase's `postgres` / `supabase_admin` where we are allowed to)
    FOREACH creator IN ARRAY ARRAY[current_user::text, 'postgres', 'supabase_admin'] LOOP
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = creator);
      BEGIN
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES    FROM %I', creator, target);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', creator, target);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', creator, target);
      EXCEPTION WHEN insufficient_privilege THEN
        -- e.g. the migrating role is not a member of supabase_admin; that role does not create
        -- BARQ objects. The DB proof covers the creating role.
        RAISE NOTICE 'default privileges of role % left unchanged (insufficient privilege)', creator;
      END;
    END LOOP;
  END LOOP;
END $$;

-- PUBLIC (inherited by every role, anon / authenticated included)
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- USAGE on schema public stays with PUBLIC: it grants access to no object by itself, and other
-- platform roles may rely on it.

-- Future routines: PostgreSQL grants EXECUTE to PUBLIC on every new function through a GLOBAL
-- built-in default that a per-schema rule cannot revoke. Revoking it globally would also change
-- functions the creating role later adds in platform schemas (e.g. `extensions`), so it is NOT done
-- here (owner decision 2026-10-22). Instead, scripts/engineering/check-migrations.mjs rejects any
-- migration that creates a function or procedure in `public` without, in the same migration,
-- REVOKE EXECUTE … FROM PUBLIC, anon, authenticated.
