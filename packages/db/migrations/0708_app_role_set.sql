-- The request path switches into vantage_app for the length of one transaction
-- (SET LOCAL ROLE). On PostgreSQL 16 a role grant can exist and still refuse
-- that switch when SET is false, which made every signed-in page look like
-- unfinished setup. Neon’s owner login is a member; it must be allowed to
-- assume the role. Local databases have no neondb_owner, so this is a no-op there.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neondb_owner')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vantage_app') THEN
    GRANT vantage_app TO neondb_owner WITH SET TRUE;
  END IF;
END $$;
