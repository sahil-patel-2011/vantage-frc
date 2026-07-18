-- Live scout ↔ TBA/Statbotics cross-validation storage (CD #1).
-- Append-only; IF NOT EXISTS so partial applies stay idempotent.

ALTER TABLE scout_schemas
  ADD COLUMN IF NOT EXISTS cloned_from_schema_id uuid REFERENCES scout_schemas(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS scout_field_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  schema_id uuid NOT NULL REFERENCES scout_schemas(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  preferred_source text NOT NULL DEFAULT 'consensus'
    CHECK (preferred_source IN ('scout','tba','statbotics','consensus')),
  official_key text,
  team_indexed boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, schema_id, field_key)
);

CREATE TABLE IF NOT EXISTS scout_entry_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES match_scout_entries(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  scout_value jsonb,
  official_value jsonb,
  official_source text NOT NULL DEFAULT 'tba',
  status text NOT NULL CHECK (status IN ('match','conflict','unavailable','not_comparable')),
  detail text NOT NULL DEFAULT '',
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_id, field_key, official_source)
);
CREATE INDEX IF NOT EXISTS scout_validations_org_status_idx
  ON scout_entry_validations(org_id, status, checked_at DESC);

ALTER TABLE scout_field_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_entry_validations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scout_field_policies_read ON scout_field_policies;
CREATE POLICY scout_field_policies_read ON scout_field_policies FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
DROP POLICY IF EXISTS scout_field_policies_admin_write ON scout_field_policies;
CREATE POLICY scout_field_policies_admin_write ON scout_field_policies FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND updated_by=current_app_user_id());
DROP POLICY IF EXISTS scout_entry_validations_read ON scout_entry_validations;
CREATE POLICY scout_entry_validations_read ON scout_entry_validations FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
DROP POLICY IF EXISTS scout_entry_validations_member_write ON scout_entry_validations;
CREATE POLICY scout_entry_validations_member_write ON scout_entry_validations FOR ALL TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

GRANT SELECT,INSERT,UPDATE,DELETE ON scout_field_policies,scout_entry_validations TO vantage_app,vantage_worker;
