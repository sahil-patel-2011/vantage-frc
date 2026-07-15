ALTER TABLE invites ADD COLUMN accepted_by uuid REFERENCES users(id);
ALTER TABLE invites ADD COLUMN accepted_at timestamptz;
ALTER TABLE invites ADD COLUMN last_sent_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX organizations_team_number_uq ON organizations(team_number)
  WHERE team_number IS NOT NULL;
CREATE INDEX invites_org_status_idx ON invites(org_id,status,created_at);

CREATE TABLE auth_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  email_hash text,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  success boolean NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_audit_action_created_idx ON auth_audit_events(action,created_at);
ALTER TABLE auth_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_audit_auth_insert ON auth_audit_events FOR INSERT TO vantage_auth
  WITH CHECK (true);
CREATE POLICY auth_audit_platform_read ON auth_audit_events FOR SELECT TO vantage_app
  USING (is_platform_admin());
GRANT INSERT ON auth_audit_events TO vantage_auth;
GRANT SELECT ON auth_audit_events TO vantage_app;

CREATE TABLE membership_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  invite_id uuid REFERENCES invites(id) ON DELETE SET NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  target_email_hash text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX membership_audit_org_created_idx ON membership_audit_events(org_id,created_at);
ALTER TABLE membership_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_audit_member_read ON membership_audit_events FOR SELECT TO vantage_app
  USING (org_id IS NOT NULL AND is_org_member(org_id) OR is_platform_admin());
CREATE POLICY membership_audit_actor_insert ON membership_audit_events FOR INSERT TO vantage_app
  WITH CHECK (actor_user_id=current_app_user_id() AND (
    is_platform_admin() OR (org_id IS NOT NULL AND has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
  ));
GRANT SELECT,INSERT ON membership_audit_events TO vantage_app;

DROP POLICY memberships_admin_write ON memberships;
CREATE POLICY memberships_admin_update ON memberships FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY memberships_admin_delete ON memberships FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY memberships_platform_seed ON memberships FOR INSERT TO vantage_app
  WITH CHECK (is_platform_admin());
CREATE POLICY organizations_platform_create ON organizations FOR INSERT TO vantage_app
  WITH CHECK (is_platform_admin());
CREATE POLICY organizations_platform_read ON organizations FOR SELECT TO vantage_app
  USING (is_platform_admin());
CREATE POLICY organizations_platform_update ON organizations FOR UPDATE TO vantage_app
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY memberships_platform_read ON memberships FOR SELECT TO vantage_app
  USING (is_platform_admin());

CREATE OR REPLACE FUNCTION accept_org_invite(raw_token text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  candidate invites%ROWTYPE;
  current_user users%ROWTYPE;
BEGIN
  SELECT * INTO current_user FROM users WHERE id=current_app_user_id();
  IF current_user.id IS NULL OR NOT current_user.email_verified THEN
    RAISE EXCEPTION 'A verified email is required';
  END IF;
  SELECT * INTO candidate FROM invites
    WHERE token_hash=encode(digest(raw_token,'sha256'),'hex')
    FOR UPDATE;
  IF candidate.id IS NULL OR candidate.status <> 'pending' THEN
    RAISE EXCEPTION 'Invite is invalid or already used';
  END IF;
  IF candidate.expires_at <= now() THEN
    UPDATE invites SET status='expired' WHERE id=candidate.id;
    RAISE EXCEPTION 'Invite has expired';
  END IF;
  IF lower(candidate.email) <> lower(current_user.email) THEN
    RAISE EXCEPTION 'Invite email does not match the signed-in account';
  END IF;
  INSERT INTO memberships(org_id,user_id,role)
    VALUES(candidate.org_id,current_user.id,candidate.role)
    ON CONFLICT(org_id,user_id) DO NOTHING;
  UPDATE invites SET status='accepted',accepted_by=current_user.id,accepted_at=now()
    WHERE id=candidate.id;
  RETURN candidate.org_id;
END $$;
REVOKE ALL ON FUNCTION accept_org_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_org_invite(text) TO vantage_app;

CREATE OR REPLACE FUNCTION expire_org_invites() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE changed integer;
BEGIN
  UPDATE invites SET status='expired' WHERE status='pending' AND expires_at <= now();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;
REVOKE ALL ON FUNCTION expire_org_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION expire_org_invites() TO vantage_app,vantage_worker;
