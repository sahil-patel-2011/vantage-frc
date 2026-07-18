-- RSVPs for subteam calendar events ("I'm going" / maybe / no).
-- Members toggle their own response; the whole org can read counts for planning.

CREATE TABLE IF NOT EXISTS subteam_calendar_rsvps (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES subteam_calendar_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response text NOT NULL CHECK (response IN ('going', 'maybe', 'no')),
  note text NOT NULL DEFAULT '',
  responded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS subteam_calendar_rsvps_org_idx
  ON subteam_calendar_rsvps(org_id, event_id);
CREATE INDEX IF NOT EXISTS subteam_calendar_rsvps_user_idx
  ON subteam_calendar_rsvps(org_id, user_id);

ALTER TABLE subteam_calendar_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subteam_calendar_rsvps_read ON subteam_calendar_rsvps;
DROP POLICY IF EXISTS subteam_calendar_rsvps_write ON subteam_calendar_rsvps;

CREATE POLICY subteam_calendar_rsvps_read ON subteam_calendar_rsvps
  FOR SELECT TO vantage_app USING (is_org_member(org_id));

CREATE POLICY subteam_calendar_rsvps_write ON subteam_calendar_rsvps
  FOR ALL TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON subteam_calendar_rsvps TO vantage_app, vantage_worker;
