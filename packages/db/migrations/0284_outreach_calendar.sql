-- Outreach Calendar: forward-looking outreach EVENT PLANNING with projected impact metrics
-- (projected hours, projected people reached). Distinct from 0038 `impact_activities`, which
-- logs outreach that already happened.

CREATE TABLE outreach_calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'community_event'
    CHECK (category IN ('stem_demo','mentoring','community_event','fundraising','media','other')),
  scheduled_on date NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','confirmed','completed','canceled')),
  audience text NOT NULL DEFAULT 'public'
    CHECK (audience IN ('k12','college','public','industry','other_teams','internal','other')),
  projected_hours numeric NOT NULL DEFAULT 0 CHECK (projected_hours >= 0),
  projected_people_reached integer NOT NULL DEFAULT 0 CHECK (projected_people_reached >= 0),
  location text,
  notes text,
  season_year integer NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outreach_calendar_events_org_season_idx
  ON outreach_calendar_events(org_id, season_year, scheduled_on ASC);

ALTER TABLE outreach_calendar_events ENABLE ROW LEVEL SECURITY;

-- Any org member may read and manage the shared outreach plan; inserts stamp the author.
CREATE POLICY outreach_calendar_events_member_read ON outreach_calendar_events FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY outreach_calendar_events_member_insert ON outreach_calendar_events FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY outreach_calendar_events_member_update ON outreach_calendar_events FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY outreach_calendar_events_member_delete ON outreach_calendar_events FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON outreach_calendar_events TO vantage_app, vantage_worker;
