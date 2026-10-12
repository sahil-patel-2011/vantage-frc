-- Run ONCE on a Supabase project as the postgres role, after 00_roles.sql and BEFORE the
-- numbered Vantage migrations. Safe to run again. Do not run this on Neon or a NAS.
--
-- Supabase installs pgcrypto in the "extensions" schema; Neon and a plain Postgres put it in
-- public. Vantage's SECURITY DEFINER functions pin `SET search_path = public` (so a caller
-- cannot shadow what they call) and call digest(), gen_random_bytes() and crypt() by bare name,
-- as does request SQL running as vantage_app. These wrappers give those names a home in public
-- that forwards to the real extension functions, so every migration and query behaves exactly
-- as it does on Neon. Nothing else changes: the extension itself stays where Supabase put it.

CREATE OR REPLACE FUNCTION public.digest(data text, type text) RETURNS bytea
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT extensions.digest(data, type) $$;
CREATE OR REPLACE FUNCTION public.digest(data bytea, type text) RETURNS bytea
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT extensions.digest(data, type) $$;
CREATE OR REPLACE FUNCTION public.hmac(data text, key text, type text) RETURNS bytea
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT extensions.hmac(data, key, type) $$;
CREATE OR REPLACE FUNCTION public.hmac(data bytea, key bytea, type text) RETURNS bytea
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT extensions.hmac(data, key, type) $$;
CREATE OR REPLACE FUNCTION public.gen_random_bytes(count integer) RETURNS bytea
  LANGUAGE sql VOLATILE STRICT PARALLEL SAFE AS $$ SELECT extensions.gen_random_bytes(count) $$;
CREATE OR REPLACE FUNCTION public.crypt(password text, salt text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$ SELECT extensions.crypt(password, salt) $$;
CREATE OR REPLACE FUNCTION public.gen_salt(type text) RETURNS text
  LANGUAGE sql VOLATILE STRICT PARALLEL SAFE AS $$ SELECT extensions.gen_salt(type) $$;
CREATE OR REPLACE FUNCTION public.gen_salt(type text, rounds integer) RETURNS text
  LANGUAGE sql VOLATILE STRICT PARALLEL SAFE AS $$ SELECT extensions.gen_salt(type, rounds) $$;

GRANT EXECUTE ON FUNCTION
  public.digest(text, text), public.digest(bytea, text),
  public.hmac(text, text, text), public.hmac(bytea, bytea, text),
  public.gen_random_bytes(integer), public.crypt(text, text),
  public.gen_salt(text), public.gen_salt(text, integer)
TO vantage_app, vantage_worker;

-- The app's own logins find the extensions too, as Supabase's postgres role does.
ALTER ROLE vantage_app SET search_path = "$user", public, extensions;
ALTER ROLE vantage_worker SET search_path = "$user", public, extensions;

-- 00_roles.sql creates vantage_worker before migration 0001 can, so 0001's
-- `CREATE ROLE vantage_worker … BYPASSRLS` never runs. Background jobs read across teams the
-- way they do on Neon only with it (Supabase's postgres role has BYPASSRLS and created this one).
ALTER ROLE vantage_worker BYPASSRLS;

-- Supabase grants every new table in public to its Data API roles (anon, authenticated) by
-- default. Vantage tables are never meant for that API (0432 revokes what exists by then); stop
-- the grants before the first table is created so none is ever exposed, even briefly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;
  END IF;
END $$;
