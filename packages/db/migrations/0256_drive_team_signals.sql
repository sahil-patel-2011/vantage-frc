-- Drive-team signal board: standardized driver / human-player comms cheat-sheets per game.
-- Each sheet is a titled cheat-sheet (one per game/season, optionally scoped to an event)
-- holding an ordered list of signals (hand signal / verbal callout / radio code / field
-- marker) so the whole drive team + human player agree on the same vocabulary before
-- they hit the field. Signals live as jsonb on the sheet (small, always read/written whole)
-- rather than a child table — mirrors match_checklist_runs.items.

CREATE TABLE drive_team_signals_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  game_year integer NOT NULL,
  event_key text,
  signals jsonb NOT NULL DEFAULT '[]',
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drive_team_signals_sheets_org_year_idx
  ON drive_team_signals_sheets(org_id, game_year DESC, created_at DESC);

ALTER TABLE drive_team_signals_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY drive_team_signals_sheets_member_read ON drive_team_signals_sheets FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY drive_team_signals_sheets_member_insert ON drive_team_signals_sheets FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY drive_team_signals_sheets_member_update ON drive_team_signals_sheets FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY drive_team_signals_sheets_member_delete ON drive_team_signals_sheets FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON drive_team_signals_sheets TO vantage_app, vantage_worker;
