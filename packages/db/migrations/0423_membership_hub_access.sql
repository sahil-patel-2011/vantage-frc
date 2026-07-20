-- Per-member Soft-UI hub/tab allowlists. No rows = unrestricted (compat).
-- Any rows for a member = allowlist mode for listed hubs only (+ Home/Account/Help in app).

CREATE TABLE membership_hub_access (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hub_id text NOT NULL
    CHECK (hub_id IN ('competition', 'team', 'business', 'build', 'ai', 'media')),
  allowed_tab_ids text[] NOT NULL DEFAULT '{}',
  granted_by uuid NOT NULL REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, hub_id)
);

CREATE INDEX membership_hub_access_user_idx
  ON membership_hub_access (user_id, org_id);

ALTER TABLE membership_hub_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY membership_hub_access_member_read ON membership_hub_access
  FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
      OR is_platform_admin()
    )
  );

CREATE POLICY membership_hub_access_admin_write ON membership_hub_access
  FOR ALL TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR is_platform_admin()
  )
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR is_platform_admin()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON membership_hub_access TO vantage_app, vantage_worker;

COMMENT ON TABLE membership_hub_access IS
  'Lead-controlled Soft-UI hub/tab allowlists; empty set of rows means unrestricted access';
