-- Open team join links: a coach/owner can share one URL. Anyone who opens it
-- can create an account (Google or email) and join that team, up to 50 uses.
-- Exact-email invites stay unchanged.

CREATE TABLE IF NOT EXISTS team_join_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  member_role org_role NOT NULL DEFAULT 'scout'
    CHECK (member_role IN ('scout', 'viewer')),
  max_uses integer NOT NULL DEFAULT 50 CHECK (max_uses BETWEEN 1 AND 50),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_join_links_uses_ok CHECK (use_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS team_join_links_org_idx
  ON team_join_links (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS team_join_link_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES team_join_links(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, user_id)
);

CREATE INDEX IF NOT EXISTS team_join_link_redemptions_org_idx
  ON team_join_link_redemptions (org_id, created_at DESC);

ALTER TABLE team_join_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_join_link_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_join_links_read ON team_join_links;
DROP POLICY IF EXISTS team_join_links_write ON team_join_links;
DROP POLICY IF EXISTS team_join_link_redemptions_read ON team_join_link_redemptions;
DROP POLICY IF EXISTS team_join_link_redemptions_insert ON team_join_link_redemptions;

CREATE POLICY team_join_links_read ON team_join_links
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY team_join_links_write ON team_join_links
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY team_join_link_redemptions_read ON team_join_link_redemptions
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY team_join_link_redemptions_insert ON team_join_link_redemptions
  FOR INSERT TO vantage_app
  WITH CHECK (user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON team_join_links TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, DELETE ON team_join_link_redemptions TO vantage_app, vantage_worker;

CREATE OR REPLACE FUNCTION peek_team_join_link(raw_token text)
RETURNS TABLE (
  org_id uuid,
  org_name text,
  team_number integer,
  member_role text,
  status text,
  remaining integer,
  max_uses integer,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  link team_join_links%ROWTYPE;
BEGIN
  SELECT * INTO link
  FROM team_join_links
  WHERE token_hash = encode(digest(raw_token, 'sha256'), 'hex')
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT o.id,
         o.name,
         o.team_number,
         link.member_role::text,
         CASE
           WHEN link.revoked_at IS NOT NULL THEN 'revoked'
           WHEN link.expires_at <= now() THEN 'expired'
           WHEN link.use_count >= link.max_uses THEN 'full'
           ELSE 'open'
         END,
         GREATEST(link.max_uses - link.use_count, 0),
         link.max_uses,
         link.expires_at
  FROM organizations o
  WHERE o.id = link.org_id;
END;
$$;

REVOKE ALL ON FUNCTION peek_team_join_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION peek_team_join_link(text) TO vantage_app, vantage_worker;

CREATE OR REPLACE FUNCTION redeem_team_join_link(raw_token text)
RETURNS TABLE (
  org_id uuid,
  org_name text,
  member_role text,
  already_member boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := current_app_user_id();
  link team_join_links%ROWTYPE;
  existing memberships%ROWTYPE;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to join this team';
  END IF;

  SELECT * INTO link
  FROM team_join_links
  WHERE token_hash = encode(digest(raw_token, 'sha256'), 'hex')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That join link is not valid';
  END IF;
  IF link.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'That join link was turned off';
  END IF;
  IF link.expires_at <= now() THEN
    RAISE EXCEPTION 'That join link has expired';
  END IF;

  SELECT * INTO existing
  FROM memberships
  WHERE org_id = link.org_id AND user_id = actor
  LIMIT 1;
  IF FOUND THEN
    RETURN QUERY
    SELECT o.id, o.name, existing.role::text, true
    FROM organizations o
    WHERE o.id = link.org_id;
    RETURN;
  END IF;

  IF link.use_count >= link.max_uses THEN
    RAISE EXCEPTION 'This join link already reached its limit';
  END IF;

  INSERT INTO memberships (org_id, user_id, role)
  VALUES (link.org_id, actor, link.member_role);

  UPDATE team_join_links
  SET use_count = use_count + 1, updated_at = now()
  WHERE id = link.id;

  INSERT INTO team_join_link_redemptions (link_id, org_id, user_id)
  VALUES (link.id, link.org_id, actor)
  ON CONFLICT (link_id, user_id) DO NOTHING;

  RETURN QUERY
  SELECT o.id, o.name, link.member_role::text, false
  FROM organizations o
  WHERE o.id = link.org_id;
END;
$$;

REVOKE ALL ON FUNCTION redeem_team_join_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION redeem_team_join_link(text) TO vantage_app, vantage_worker;
