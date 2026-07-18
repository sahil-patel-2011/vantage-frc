-- Scout Data Impact: the "where your data went" feedback loop. After alliance selection,
-- coaches/admins log the final picks here (independent of the alliance_boards jsonb draft
-- state), and the app correlates each pick's team against match_scout_entries to show every
-- scout which of their entries informed which pick.

CREATE TABLE scout_data_impact_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  alliance_number integer NOT NULL CHECK (alliance_number BETWEEN 1 AND 8),
  pick_order integer NOT NULL CHECK (pick_order >= 1),
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, team_key)
);
CREATE INDEX scout_data_impact_picks_org_event_idx
  ON scout_data_impact_picks(org_id, event_key, alliance_number, pick_order);

-- Tracks which scouts have opened/acknowledged their "your data informed this pick" summary
-- for a given event, so the feedback loop can show a read state per scout.
CREATE TABLE scout_data_impact_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  scout_user_id uuid NOT NULL REFERENCES users(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, scout_user_id)
);

ALTER TABLE scout_data_impact_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_data_impact_acknowledgments ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_data_impact_picks_member_read ON scout_data_impact_picks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_data_impact_picks_coach_insert ON scout_data_impact_picks FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND logged_by = current_app_user_id());
CREATE POLICY scout_data_impact_picks_coach_update ON scout_data_impact_picks FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_data_impact_picks_coach_delete ON scout_data_impact_picks FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY scout_data_impact_acks_member_read ON scout_data_impact_acknowledgments FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_data_impact_acks_member_insert ON scout_data_impact_acknowledgments FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND scout_user_id = current_app_user_id());
CREATE POLICY scout_data_impact_acks_member_update ON scout_data_impact_acknowledgments FOR UPDATE TO vantage_app
  USING (scout_user_id = current_app_user_id())
  WITH CHECK (scout_user_id = current_app_user_id());
CREATE POLICY scout_data_impact_acks_member_delete ON scout_data_impact_acknowledgments FOR DELETE TO vantage_app
  USING (scout_user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_data_impact_picks, scout_data_impact_acknowledgments
  TO vantage_app, vantage_worker;
