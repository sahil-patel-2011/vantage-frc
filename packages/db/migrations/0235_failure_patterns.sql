-- Repeat-failure pattern detection: annotations/acknowledgements on the recurring-failure
-- clusters the app computes by grouping existing fmea_failures + incident_reports rows by
-- subsystem ("this subsystem failed 4 times this season"). The clustering itself is a
-- read-only aggregation over those existing tables at request time; this table only stores
-- the team's follow-up on a detected cluster (acknowledge / corrective note / resolved).

CREATE TABLE failure_patterns_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem_name text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX failure_patterns_notes_org_season_idx
  ON failure_patterns_notes(org_id, season_year, subsystem_name);

ALTER TABLE failure_patterns_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY failure_patterns_notes_member_read ON failure_patterns_notes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY failure_patterns_notes_member_insert ON failure_patterns_notes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY failure_patterns_notes_member_update ON failure_patterns_notes FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY failure_patterns_notes_member_delete ON failure_patterns_notes FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON failure_patterns_notes TO vantage_app, vantage_worker;
