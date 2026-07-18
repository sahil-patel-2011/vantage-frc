-- Match Video Index: auto-index match videos by match key (event + match) for quick review.
-- Distinct from scouting notes/media — this is a lightweight link/timestamp registry teams use
-- to jump straight to the right clip for a given match without hunting through a shared drive.

CREATE TABLE match_video_index_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_key text NOT NULL,
  event_key text,
  match_label text,
  video_url text NOT NULL,
  source text NOT NULL DEFAULT 'other'
    CHECK (source IN ('youtube','drive','twitch','local','other')),
  recorded_on date,
  notes text,
  tags text[] NOT NULL DEFAULT '{}',
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX match_video_index_entries_org_match_idx
  ON match_video_index_entries(org_id, match_key, created_at DESC);

ALTER TABLE match_video_index_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_video_index_entries_member_read ON match_video_index_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY match_video_index_entries_member_insert ON match_video_index_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND added_by = current_app_user_id());
CREATE POLICY match_video_index_entries_member_update ON match_video_index_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY match_video_index_entries_member_delete ON match_video_index_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON match_video_index_entries TO vantage_app, vantage_worker;
