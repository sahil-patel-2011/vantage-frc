-- Org-scoped GitHub connection for AI chat / code-assist context (read-only API use).
-- Tokens encrypted at rest (JSON EncryptedSecret blob). No workflow scope; no push.

CREATE TABLE github_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connected_by uuid NOT NULL REFERENCES users(id),
  auth_method text NOT NULL CHECK (auth_method IN ('oauth', 'pat')),
  label text NOT NULL DEFAULT 'GitHub',
  encrypted_credentials text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'error')),
  github_login text,
  github_user_id text,
  default_repo_full_name text,
  default_repo_default_branch text,
  last_tested_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE INDEX github_connections_org_status_idx
  ON github_connections(org_id)
  WHERE disabled_at IS NULL;

ALTER TABLE github_connections ENABLE ROW LEVEL SECURITY;

-- Any member can see connection metadata (never credentials).
CREATE POLICY github_connections_member_read ON github_connections
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Owners/admins manage the org connection.
CREATE POLICY github_connections_admin_insert ON github_connections
  FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    AND connected_by = current_app_user_id()
  );

CREATE POLICY github_connections_admin_update ON github_connections
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY github_connections_admin_delete ON github_connections
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON github_connections TO vantage_app, vantage_worker;
