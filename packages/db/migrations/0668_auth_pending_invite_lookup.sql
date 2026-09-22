-- The sign-in gate asks "does this email have a live invite?" before it will
-- create an account. That question runs as vantage_auth, which can read users
-- and sessions but not invites. The SELECT failed, the error was swallowed,
-- and every invited address was treated as waitlist-only — so the first email
-- code could never open an account.
--
-- This function answers only yes or no. It does not return the token, the
-- team, or the role. The auth role is the only caller.

CREATE OR REPLACE FUNCTION auth_email_has_pending_invite(target_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM invites
    WHERE lower(email) = lower(btrim(target_email))
      AND status = 'pending'
      AND expires_at > now()
  );
$$;

REVOKE ALL ON FUNCTION auth_email_has_pending_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_email_has_pending_invite(text) TO vantage_auth;
