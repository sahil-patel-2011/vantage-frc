-- Opponent counter-book: a one-page counter-strategy per likely playoff opponent, generated
-- from THIS org's own scouting data (match_scout_entries / pit_scout_entries). Distinct from
-- strategy.match (single-match win probability) — a counter-book is opponent-centric and
-- reusable across every match against that team at an event.

CREATE TABLE counter_book_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  team_number integer,
  event_key text REFERENCES events_ref(event_key),
  title text NOT NULL,
  matches_scouted integer NOT NULL DEFAULT 0 CHECK (matches_scouted >= 0),
  tendencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_triggers jsonb NOT NULL DEFAULT '[]'::jsonb,
  counter_plan text NOT NULL,
  summary text NOT NULL,
  ai_run_id uuid,
  ai_model text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX counter_book_reports_org_team_idx ON counter_book_reports(org_id, team_key, created_at DESC);
CREATE INDEX counter_book_reports_org_event_idx ON counter_book_reports(org_id, event_key);

ALTER TABLE counter_book_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY counter_book_reports_member_read ON counter_book_reports FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY counter_book_reports_member_insert ON counter_book_reports FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY counter_book_reports_member_update ON counter_book_reports FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY counter_book_reports_member_delete ON counter_book_reports FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON counter_book_reports TO vantage_app, vantage_worker;
