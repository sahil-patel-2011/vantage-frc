-- Scouting Heat Signals: manually logged trend observations per scouted team ("this team is
-- climbing" / "this team fell off") that feed a pick-strategy trend view. Distinct from
-- 0258 epa_trend_alerts (which watches TBA/Statbotics EPA swings) — this captures scouts'
-- own qualitative/quantitative read on a team across matches they've observed.

CREATE TABLE scouting_heat_signals_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  team_number integer,
  observed_on date NOT NULL,
  direction text NOT NULL DEFAULT 'steady' CHECK (direction IN ('up', 'down', 'steady')),
  metric_value numeric,
  note text,
  match_key text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scouting_heat_signals_entries_org_team_idx
  ON scouting_heat_signals_entries(org_id, team_key, observed_on DESC);

ALTER TABLE scouting_heat_signals_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY scouting_heat_signals_entries_member_read ON scouting_heat_signals_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scouting_heat_signals_entries_member_insert ON scouting_heat_signals_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY scouting_heat_signals_entries_member_update ON scouting_heat_signals_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scouting_heat_signals_entries_member_delete ON scouting_heat_signals_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scouting_heat_signals_entries TO vantage_app, vantage_worker;
