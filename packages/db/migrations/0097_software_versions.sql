-- Robot software / firmware version tracker. One row per component (WPILib,
-- roboRIO image, vendor libraries, device firmware, driver station) recording the
-- installed version vs. the team's target version. Status (ok / update-available)
-- is computed in the app.

CREATE TABLE software_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  component text NOT NULL,
  category text NOT NULL DEFAULT 'library' CHECK (category IN ('library', 'firmware', 'image', 'tool', 'other')),
  installed_version text NOT NULL,
  target_version text,
  notes text NOT NULL DEFAULT '',
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, component)
);
CREATE INDEX software_versions_org_season_idx ON software_versions(org_id, season_year);

ALTER TABLE software_versions ENABLE ROW LEVEL SECURITY;

-- Robot software config is collaborative: any member can record/update/remove it.
CREATE POLICY software_versions_read ON software_versions FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY software_versions_insert ON software_versions FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());
CREATE POLICY software_versions_update ON software_versions FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());
CREATE POLICY software_versions_delete ON software_versions FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON software_versions TO vantage_app, vantage_worker;
