-- Internal team recognition: end-of-season member awards the team nominates and
-- votes on (MVP, Most Improved, Best Mentor…). Distinct from the FIRST
-- competition awards tracked in 0036/award_submissions. Cycle: nominating ->
-- voting -> closed. One vote per member per award (changeable while voting).

CREATE TABLE recognition_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'nominating' CHECK (stage IN ('nominating', 'voting', 'closed')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recognition_awards_org_season_idx ON recognition_awards(org_id, season_year);

CREATE TABLE recognition_nominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  award_id uuid NOT NULL REFERENCES recognition_awards(id) ON DELETE CASCADE,
  nominee_name text NOT NULL,
  reason text NOT NULL DEFAULT '',
  nominated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recognition_nominations_award_idx ON recognition_nominations(award_id);

CREATE TABLE recognition_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  award_id uuid NOT NULL REFERENCES recognition_awards(id) ON DELETE CASCADE,
  nomination_id uuid NOT NULL REFERENCES recognition_nominations(id) ON DELETE CASCADE,
  voter_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (award_id, voter_user_id)
);
CREATE INDEX recognition_votes_award_idx ON recognition_votes(award_id);

ALTER TABLE recognition_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE recognition_nominations ENABLE ROW LEVEL SECURITY;
ALTER TABLE recognition_votes ENABLE ROW LEVEL SECURITY;

-- Owners/admins run the award cycle; members nominate and vote (one vote each).
CREATE POLICY recognition_awards_read ON recognition_awards FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY recognition_awards_write ON recognition_awards FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]) AND created_by = current_app_user_id());

CREATE POLICY recognition_nominations_read ON recognition_nominations FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY recognition_nominations_insert ON recognition_nominations FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND nominated_by = current_app_user_id());
CREATE POLICY recognition_nominations_delete ON recognition_nominations FOR DELETE TO vantage_app USING (nominated_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY recognition_votes_read ON recognition_votes FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY recognition_votes_insert ON recognition_votes FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND voter_user_id = current_app_user_id());
CREATE POLICY recognition_votes_update ON recognition_votes FOR UPDATE TO vantage_app USING (voter_user_id = current_app_user_id()) WITH CHECK (voter_user_id = current_app_user_id());
CREATE POLICY recognition_votes_delete ON recognition_votes FOR DELETE TO vantage_app USING (voter_user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON recognition_awards, recognition_nominations, recognition_votes TO vantage_app, vantage_worker;
