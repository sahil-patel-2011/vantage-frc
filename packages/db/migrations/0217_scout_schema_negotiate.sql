-- Scout schema-version negotiation: reconciles scouting submissions that were captured on
-- an older tablet-side form schema instead of silently dropping them. Teams register each
-- known schema version's field set; submissions tagged with a stale schema_version are staged
-- with a computed field diff (missing/extra) so a lead scout can reconcile or reject them
-- rather than losing the data outright.

CREATE TABLE scout_schema_negotiate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_tag text NOT NULL,
  field_keys text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, version_tag)
);
CREATE INDEX scout_schema_negotiate_versions_org_idx ON scout_schema_negotiate_versions(org_id, is_active);

ALTER TABLE scout_schema_negotiate_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_schema_negotiate_versions_member_read ON scout_schema_negotiate_versions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_schema_negotiate_versions_member_insert ON scout_schema_negotiate_versions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY scout_schema_negotiate_versions_member_update ON scout_schema_negotiate_versions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_schema_negotiate_versions_member_delete ON scout_schema_negotiate_versions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_schema_negotiate_versions TO vantage_app, vantage_worker;

CREATE TABLE scout_schema_negotiate_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  schema_version text NOT NULL,
  match_number integer,
  team_number integer,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reconciled', 'rejected')),
  missing_fields text[] NOT NULL DEFAULT '{}',
  extra_fields text[] NOT NULL DEFAULT '{}',
  notes text,
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scout_schema_negotiate_submissions_org_status_idx
  ON scout_schema_negotiate_submissions(org_id, status, submitted_at DESC);

ALTER TABLE scout_schema_negotiate_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_schema_negotiate_submissions_member_read ON scout_schema_negotiate_submissions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_schema_negotiate_submissions_member_insert ON scout_schema_negotiate_submissions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND submitted_by = current_app_user_id());
CREATE POLICY scout_schema_negotiate_submissions_member_update ON scout_schema_negotiate_submissions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_schema_negotiate_submissions_member_delete ON scout_schema_negotiate_submissions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_schema_negotiate_submissions TO vantage_app, vantage_worker;
