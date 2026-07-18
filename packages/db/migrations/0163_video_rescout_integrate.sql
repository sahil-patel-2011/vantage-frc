-- CD #7 integrate: link video-rescored scout entries into quality, TBA validation,
-- and strategy provenance. Idempotent with 0157_video_rescout where overlap exists.

ALTER TYPE scout_source ADD VALUE IF NOT EXISTS 'video';

ALTER TABLE video_reviews
  ADD COLUMN IF NOT EXISTS assigned_team_keys text[] NOT NULL DEFAULT '{}';

ALTER TABLE video_reviews
  DROP CONSTRAINT IF EXISTS video_reviews_assigned_team_keys_len;

ALTER TABLE video_reviews
  ADD CONSTRAINT video_reviews_assigned_team_keys_len
  CHECK (cardinality(assigned_team_keys) <= 4);

CREATE TABLE IF NOT EXISTS video_timeline_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES video_reviews(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  at_seconds integer NOT NULL CHECK (at_seconds >= 0 AND at_seconds <= 21600),
  field_key text NOT NULL CHECK (char_length(field_key) BETWEEN 1 AND 80),
  value jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_timeline_scores_review_idx
  ON video_timeline_scores(review_id, at_seconds, team_key);

CREATE INDEX IF NOT EXISTS video_timeline_scores_org_idx
  ON video_timeline_scores(org_id, review_id);

ALTER TABLE video_timeline_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_timeline_scores_read ON video_timeline_scores;
DROP POLICY IF EXISTS video_timeline_scores_insert ON video_timeline_scores;
DROP POLICY IF EXISTS video_timeline_scores_update ON video_timeline_scores;
DROP POLICY IF EXISTS video_timeline_scores_delete ON video_timeline_scores;

CREATE POLICY video_timeline_scores_read ON video_timeline_scores
  FOR SELECT TO vantage_app USING (is_org_member(org_id));

CREATE POLICY video_timeline_scores_insert ON video_timeline_scores
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

CREATE POLICY video_timeline_scores_update ON video_timeline_scores
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY video_timeline_scores_delete ON video_timeline_scores
  FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON video_timeline_scores TO vantage_app, vantage_worker;

ALTER TABLE match_scout_entries
  ADD COLUMN IF NOT EXISTS video_review_id uuid REFERENCES video_reviews(id) ON DELETE SET NULL;

ALTER TABLE match_scout_entries
  ADD COLUMN IF NOT EXISTS video_at_seconds integer
  CHECK (video_at_seconds IS NULL OR (video_at_seconds >= 0 AND video_at_seconds <= 21600));

CREATE INDEX IF NOT EXISTS match_scout_entries_video_review_idx
  ON match_scout_entries(video_review_id)
  WHERE video_review_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS match_scout_entries_org_source_idx
  ON match_scout_entries(org_id, source);
