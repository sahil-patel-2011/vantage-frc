-- Robot weigh-in log: the recorded weigh-in ACTIVITY record (date, weight, station, notes) that
-- tracks the robot's mass trend against the competition weight limit across the build season.

CREATE TABLE robot_weigh_in_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  weighed_on date NOT NULL,
  weight_lbs numeric(6,2) NOT NULL CHECK (weight_lbs >= 0),
  weight_limit_lbs numeric(6,2) NOT NULL DEFAULT 125 CHECK (weight_limit_lbs > 0),
  station text NOT NULL DEFAULT 'shop'
    CHECK (station IN ('shop','event_inspection','practice_field','other')),
  bumpers_on boolean NOT NULL DEFAULT true,
  battery_on boolean NOT NULL DEFAULT true,
  season_year integer NOT NULL,
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX robot_weigh_in_entries_org_season_idx
  ON robot_weigh_in_entries(org_id, season_year, weighed_on DESC);

ALTER TABLE robot_weigh_in_entries ENABLE ROW LEVEL SECURITY;

-- Any org member may read and manage the shared weigh-in log; inserts stamp the author.
CREATE POLICY robot_weigh_in_entries_member_read ON robot_weigh_in_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY robot_weigh_in_entries_member_insert ON robot_weigh_in_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY robot_weigh_in_entries_member_update ON robot_weigh_in_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY robot_weigh_in_entries_member_delete ON robot_weigh_in_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON robot_weigh_in_entries TO vantage_app, vantage_worker;
