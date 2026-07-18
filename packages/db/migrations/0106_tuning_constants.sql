-- Tuning / calibration constants log. The tuned values teams hate to lose:
-- swerve encoder offsets, PID/feedforward gains, sensor zeros, vision transforms.
-- Value stored as text so any form (radians, gains, arrays) round-trips. Unique
-- per (org, season, subsystem, name) so re-saving updates in place.

CREATE TABLE tuning_constants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem text NOT NULL DEFAULT '',
  name text NOT NULL,
  value text NOT NULL,
  unit text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('encoder_offset', 'pid', 'feedforward', 'sensor', 'vision', 'limit', 'gearing', 'other')),
  notes text NOT NULL DEFAULT '',
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, subsystem, name)
);
CREATE INDEX tuning_constants_org_season_idx ON tuning_constants(org_id, season_year, subsystem);

ALTER TABLE tuning_constants ENABLE ROW LEVEL SECURITY;

-- Robot tuning is collaborative: any member can record/update/remove constants.
CREATE POLICY tuning_constants_read ON tuning_constants FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY tuning_constants_insert ON tuning_constants FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());
CREATE POLICY tuning_constants_update ON tuning_constants FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());
CREATE POLICY tuning_constants_delete ON tuning_constants FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON tuning_constants TO vantage_app, vantage_worker;
