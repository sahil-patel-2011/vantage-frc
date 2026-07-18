-- Bus-factor / burnout early-warning: weekly per-member workload log (hours + task
-- concentration + self/team-reported "sole knowledge" flags) that substantiates the
-- single-point-of-human-failure and overload risk views. Privacy-safe by design: only
-- aggregated counts/hours are logged, never free-text performance notes about a person.

CREATE TABLE bus_factor_workload_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES users(id),
  area text NOT NULL DEFAULT 'other'
    CHECK (area IN ('mechanical','electrical','software','strategy','scouting','business','admin','other')),
  week_start date NOT NULL,
  hours_logged numeric(6,2) NOT NULL DEFAULT 0 CHECK (hours_logged >= 0),
  tasks_owned integer NOT NULL DEFAULT 0 CHECK (tasks_owned >= 0),
  sole_knowledge_count integer NOT NULL DEFAULT 0 CHECK (sole_knowledge_count >= 0),
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bus_factor_workload_entries_org_week_idx
  ON bus_factor_workload_entries(org_id, week_start DESC);
CREATE INDEX bus_factor_workload_entries_org_member_idx
  ON bus_factor_workload_entries(org_id, member_user_id);

ALTER TABLE bus_factor_workload_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY bus_factor_workload_entries_member_read ON bus_factor_workload_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY bus_factor_workload_entries_member_insert ON bus_factor_workload_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY bus_factor_workload_entries_member_update ON bus_factor_workload_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY bus_factor_workload_entries_member_delete ON bus_factor_workload_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON bus_factor_workload_entries TO vantage_app, vantage_worker;
