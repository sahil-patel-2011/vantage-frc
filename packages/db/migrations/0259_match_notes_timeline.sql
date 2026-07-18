-- In-match note timeline: timestamped notes synced to the match clock for later review.
-- Distinct from scouting match observations — this is a lightweight, freeform note log keyed to
-- match clock time (seconds into auto/teleop/endgame) so a team can replay "what happened when"
-- during film review, alliance debriefs, or drive-coach retros.

CREATE TABLE match_notes_timeline_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_label text NOT NULL,
  match_key text,
  team_number integer,
  season_year integer NOT NULL,
  phase text NOT NULL DEFAULT 'teleop'
    CHECK (phase IN ('auto', 'teleop', 'endgame', 'other')),
  category text NOT NULL DEFAULT 'observation'
    CHECK (category IN ('observation', 'strategy', 'issue', 'highlight', 'other')),
  clock_seconds integer NOT NULL DEFAULT 0 CHECK (clock_seconds >= 0),
  note text NOT NULL,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX match_notes_timeline_entries_org_season_idx
  ON match_notes_timeline_entries(org_id, season_year, match_label, clock_seconds);

ALTER TABLE match_notes_timeline_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_notes_timeline_entries_member_read ON match_notes_timeline_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY match_notes_timeline_entries_member_insert ON match_notes_timeline_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY match_notes_timeline_entries_member_update ON match_notes_timeline_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY match_notes_timeline_entries_member_delete ON match_notes_timeline_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON match_notes_timeline_entries TO vantage_app, vantage_worker;
