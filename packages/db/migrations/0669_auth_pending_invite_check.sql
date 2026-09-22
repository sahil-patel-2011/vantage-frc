-- The sign-up gate could not see invites.
--
-- databaseHooks.user.create.before lets a new account in when the address is
-- the platform owner, already a user, or holds a pending invite. It runs on the
-- auth connection (vantage_auth), and vantage_auth has never had SELECT on
-- `invites` — so the invite lookup raised "permission denied", the gate caught
-- it, and every invited student who had not signed in before was refused as
-- "waitlist-only". Only accounts created some other way ever got in.
--
-- Granting vantage_auth SELECT on invites would hand the auth role every
-- invite token and email in every team. This answers the one question the
-- gate asks — does this address hold a live invite — and nothing else.

CREATE OR REPLACE FUNCTION auth_email_has_pending_invite(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM invites
     WHERE lower(email) = lower(trim(p_email))
       AND status = 'pending'
       AND expires_at > now()
  );
$$;

REVOKE ALL ON FUNCTION auth_email_has_pending_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_email_has_pending_invite(text) TO vantage_auth, vantage_app, vantage_worker;
