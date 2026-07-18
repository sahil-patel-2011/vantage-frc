-- Robot Readiness Score & ship copilot: one grounded index across subsystem wiring/code
-- state, open FMEA, weight/power headroom, and the bring-up checklist. Orders the fix list
-- for what to close before the robot ships to the field. Reads existing fmea_failures
-- (0153_fmea_failure_log.sql) for the FMEA-clearance axis; does not own that table.

CREATE TABLE readiness_score_subsystems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  weight_lbs numeric(6,2) NOT NULL DEFAULT 0 CHECK (weight_lbs >= 0),
  power_draw_amps numeric(6,2) NOT NULL DEFAULT 0 CHECK (power_draw_amps >= 0),
  wiring_status text NOT NULL DEFAULT 'not_started'
    CHECK (wiring_status IN ('not_started', 'in_progress', 'verified')),
  code_version_status text NOT NULL DEFAULT 'stale'
    CHECK (code_version_status IN ('stale', 'building', 'deployed_untested', 'deployed_tested')),
  health_score numeric(4,3) NOT NULL DEFAULT 0 CHECK (health_score BETWEEN 0 AND 1),
  notes text,
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, name)
);
CREATE INDEX readiness_score_subsystems_org_season_idx
  ON readiness_score_subsystems(org_id, season_year, name);

ALTER TABLE readiness_score_subsystems ENABLE ROW LEVEL SECURITY;

CREATE POLICY readiness_score_subsystems_member_read ON readiness_score_subsystems FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY readiness_score_subsystems_member_insert ON readiness_score_subsystems FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());
CREATE POLICY readiness_score_subsystems_member_update ON readiness_score_subsystems FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY readiness_score_subsystems_member_delete ON readiness_score_subsystems FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON readiness_score_subsystems TO vantage_app, vantage_worker;

CREATE TABLE readiness_score_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem_name text,
  label text NOT NULL,
  is_complete boolean NOT NULL DEFAULT false,
  sequence integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX readiness_score_checklist_items_org_season_idx
  ON readiness_score_checklist_items(org_id, season_year, sequence);

ALTER TABLE readiness_score_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY readiness_score_checklist_items_member_read ON readiness_score_checklist_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY readiness_score_checklist_items_member_insert ON readiness_score_checklist_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY readiness_score_checklist_items_member_update ON readiness_score_checklist_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY readiness_score_checklist_items_member_delete ON readiness_score_checklist_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON readiness_score_checklist_items TO vantage_app, vantage_worker;
