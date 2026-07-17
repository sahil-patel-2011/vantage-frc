-- Community Impact log: the outreach / STEM / mentoring ACTIVITY record that substantiates
-- the Impact and Engineering Inspiration awards (hours contributed, people reached, audiences
-- served). Distinct from 0036 sponsor `outreach_messages` (fundraising communications).

CREATE TABLE impact_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'community_event'
    CHECK (category IN ('stem_demo','mentoring','community_event','competition','media','sustainability','other')),
  occurred_on date NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  participant_count integer NOT NULL DEFAULT 0 CHECK (participant_count >= 0),
  people_reached integer NOT NULL DEFAULT 0 CHECK (people_reached >= 0),
  audience text NOT NULL DEFAULT 'public'
    CHECK (audience IN ('k12','college','public','industry','other_teams','internal','other')),
  location text,
  season_year integer NOT NULL,
  description text,
  evidence_awards text[] NOT NULL DEFAULT '{}',
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX impact_activities_org_season_idx ON impact_activities(org_id, season_year, occurred_on DESC);

ALTER TABLE impact_activities ENABLE ROW LEVEL SECURITY;

-- Any org member may read and manage the shared community-impact log; inserts stamp the author.
CREATE POLICY impact_activities_member_read ON impact_activities FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY impact_activities_member_insert ON impact_activities FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY impact_activities_member_update ON impact_activities FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY impact_activities_member_delete ON impact_activities FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON impact_activities TO vantage_app, vantage_worker;
