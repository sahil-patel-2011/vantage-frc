-- Personal and org-shared customizable dashboards with RLS-scoped layouts.
CREATE TABLE dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('personal', 'org')),
  is_active boolean NOT NULL DEFAULT false,
  layout jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboards_scope_owner_chk CHECK (
    (scope = 'personal' AND owner_user_id IS NOT NULL)
    OR (scope = 'org' AND owner_user_id IS NULL)
  )
);

CREATE UNIQUE INDEX dashboards_personal_active_uq
  ON dashboards(org_id, owner_user_id)
  WHERE scope = 'personal' AND is_active = true;

CREATE UNIQUE INDEX dashboards_org_active_uq
  ON dashboards(org_id)
  WHERE scope = 'org' AND is_active = true;

CREATE INDEX dashboards_org_owner_idx ON dashboards(org_id, owner_user_id);
CREATE INDEX dashboards_org_scope_idx ON dashboards(org_id, scope);

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;

-- Members can read personal dashboards they own and all org-shared dashboards in their org.
CREATE POLICY dashboards_member_read ON dashboards FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      (scope = 'personal' AND owner_user_id = current_app_user_id())
      OR scope = 'org'
      OR is_platform_admin()
    )
  );

-- Users manage their own personal dashboards.
CREATE POLICY dashboards_personal_write ON dashboards FOR ALL TO vantage_app
  USING (
    scope = 'personal'
    AND owner_user_id = current_app_user_id()
    AND is_org_member(org_id)
  )
  WITH CHECK (
    scope = 'personal'
    AND owner_user_id = current_app_user_id()
    AND created_by = current_app_user_id()
    AND is_org_member(org_id)
  );

-- Owner/admin manage org-shared dashboards.
CREATE POLICY dashboards_org_write ON dashboards FOR ALL TO vantage_app
  USING (
    scope = 'org'
    AND has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  )
  WITH CHECK (
    scope = 'org'
    AND owner_user_id IS NULL
    AND created_by = current_app_user_id()
    AND has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON dashboards TO vantage_app, vantage_worker;
