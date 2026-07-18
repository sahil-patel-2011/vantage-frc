-- Gearbox ratio calculator. Stores a gearbox as its ordered list of gear stages
-- (driving/driven tooth counts) as JSONB; the compound reduction and output speed
-- are computed in the app.

CREATE TABLE gearboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  subsystem text NOT NULL DEFAULT '',
  stages jsonb NOT NULL DEFAULT '[]',
  motor_free_rpm numeric(7, 1) CHECK (motor_free_rpm IS NULL OR motor_free_rpm >= 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gearboxes_org_season_idx ON gearboxes(org_id, season_year, subsystem);

ALTER TABLE gearboxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY gearboxes_read ON gearboxes FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY gearboxes_insert ON gearboxes FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY gearboxes_update ON gearboxes FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY gearboxes_delete ON gearboxes FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON gearboxes TO vantage_app, vantage_worker;
