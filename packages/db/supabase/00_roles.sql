-- Run ONCE on an empty Supabase project as the postgres role, BEFORE numbered
-- Vantage migrations. Do not run this on Neon production.
--
-- Then: npm run db:migrate using DATABASE_ADMIN_URL = direct (session) URL.
-- App DATABASE_URL must be the vantage_app LOGIN role — never the supabase
-- service_role JWT and never the postgres superuser.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vantage_app') THEN
    CREATE ROLE vantage_app NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vantage_worker') THEN
    CREATE ROLE vantage_worker NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;

ALTER ROLE vantage_app LOGIN;
ALTER ROLE vantage_worker LOGIN;

GRANT CONNECT ON DATABASE postgres TO vantage_app, vantage_worker;
GRANT USAGE ON SCHEMA public TO vantage_app, vantage_worker;

-- Set passwords in the Supabase SQL editor (do not commit them):
--   ALTER ROLE vantage_app WITH PASSWORD '...';
--   ALTER ROLE vantage_worker WITH PASSWORD '...';
