-- One sign-in across two products on two hosts.
--
-- Vantage (vantagefrc.vercel.app) and Scouting (vantagefrc-scouting.vercel.app)
-- are one deployment, one database and one identity, served on two hostnames.
-- `vercel.app` is on the Public Suffix List, so a cookie can never be shared
-- between two *.vercel.app hosts — the browser refuses it by design. "Open
-- Scouting" therefore hands the signed-in person across with a one-time token:
--
--   1. On the source host, create_product_handoff() stores sha256(token) for the
--      current user, bound to the destination host, valid for 60 seconds.
--   2. The destination host calls consume_product_handoff(sha256(token), host).
--      The row is claimed atomically (used_at IS NULL), so a replayed or
--      forwarded link redeems nothing; the destination then mints its own
--      Better Auth session for that user (product-handoff-plugin.ts).
--
-- Only the hash is stored. The auth method and second-factor time of the
-- source session travel with the token so the new session satisfies the same
-- team sign-in policy the original one did — no weaker, no stronger.
--
-- On a custom domain (vantagefrc.com / scouting.vantagefrc.com) the session
-- cookie can be scoped to the parent domain and this hop becomes unnecessary;
-- the table stays harmless.

CREATE TABLE product_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  target_host text NOT NULL CHECK (length(target_host) BETWEEN 3 AND 253),
  target_path text NOT NULL CHECK (target_path LIKE '/%' AND length(target_path) <= 2048),
  auth_method text NOT NULL DEFAULT 'unknown',
  email_2fa_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '60 seconds',
  used_at timestamptz
);

CREATE INDEX product_handoffs_expiry_idx ON product_handoffs (expires_at);

ALTER TABLE product_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_handoffs FORCE ROW LEVEL SECURITY;
-- No policies and no table grants: every read and write goes through the two
-- functions below. A leaked app connection cannot list or redeem handoffs.

CREATE OR REPLACE FUNCTION create_product_handoff(
  p_token_hash text,
  p_org_id uuid,
  p_target_host text,
  p_target_path text,
  p_auth_method text,
  p_email_2fa_verified_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid := current_app_user_id();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  -- An org the person is not in is dropped, not trusted.
  IF p_org_id IS NOT NULL AND NOT is_org_member(p_org_id) THEN
    p_org_id := NULL;
  END IF;
  -- Housekeeping: expired rows are useless and small; clear this user's.
  DELETE FROM product_handoffs WHERE user_id = v_user AND expires_at < now() - interval '1 hour';
  INSERT INTO product_handoffs (
    token_hash, user_id, org_id, target_host, target_path, auth_method, email_2fa_verified_at
  ) VALUES (
    p_token_hash, v_user, p_org_id, lower(p_target_host), p_target_path,
    coalesce(nullif(p_auth_method, ''), 'unknown'), p_email_2fa_verified_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION consume_product_handoff(p_token_hash text, p_host text)
RETURNS TABLE (
  user_id uuid,
  org_id uuid,
  target_path text,
  auth_method text,
  email_2fa_verified_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE product_handoffs h
     SET used_at = now()
   WHERE h.token_hash = p_token_hash
     AND h.target_host = lower(p_host)
     AND h.used_at IS NULL
     AND h.expires_at > now()
  RETURNING h.user_id, h.org_id, h.target_path, h.auth_method, h.email_2fa_verified_at;
$$;

REVOKE ALL ON TABLE product_handoffs FROM PUBLIC;
REVOKE ALL ON FUNCTION create_product_handoff(text, uuid, text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION consume_product_handoff(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_product_handoff(text, uuid, text, text, text, timestamptz) TO vantage_app;
-- The destination host has no user session yet when it redeems, so it calls
-- this on the auth connection — the same role Better Auth itself runs as.
GRANT EXECUTE ON FUNCTION consume_product_handoff(text, text) TO vantage_auth, vantage_app;
