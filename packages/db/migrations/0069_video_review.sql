-- Match Video Review.
-- Teams re-watch match footage (TBA/YouTube) and take second-stamped notes
-- ("0:37 auto missed", "1:45 defense pinned us"). A review saves the video
-- (URL + parsed YouTube video id, optionally linked to a match/team) plus a
-- free-form summary; notes seek the embedded player when clicked.

CREATE TABLE video_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  video_id text NOT NULL,
  match_key text REFERENCES matches_ref(match_key),
  team_key text,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX video_reviews_org_idx ON video_reviews(org_id, updated_at DESC);

CREATE TABLE video_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES video_reviews(id) ON DELETE CASCADE,
  at_seconds integer NOT NULL CHECK (at_seconds >= 0 AND at_seconds <= 21600),
  tag text NOT NULL DEFAULT 'other'
    CHECK (tag IN ('auto', 'teleop', 'endgame', 'defense', 'failure', 'strategy', 'other')),
  body text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX video_notes_review_idx ON video_notes(review_id, at_seconds);

ALTER TABLE video_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_notes ENABLE ROW LEVEL SECURITY;

-- Review is a whole-team activity: members read/write; review deletion is
-- limited to the creator or an owner/admin.
CREATE POLICY video_reviews_read ON video_reviews FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY video_reviews_insert ON video_reviews FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY video_reviews_update ON video_reviews FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY video_reviews_delete ON video_reviews FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY video_notes_read ON video_notes FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY video_notes_insert ON video_notes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY video_notes_update ON video_notes FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY video_notes_delete ON video_notes FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON video_reviews, video_notes TO vantage_app, vantage_worker;
