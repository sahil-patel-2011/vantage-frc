-- Award Tracker: track award submissions across events with deadlines (Chairman's, Impact,
-- Engineering Inspiration, Woodie Flowers, etc). Distinct from 0038 impact_activities (the
-- outreach evidence log) — this is the submission/deadline workflow record itself.

CREATE TABLE award_tracker_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  award_type text NOT NULL DEFAULT 'other'
    CHECK (award_type IN (
      'chairmans','impact','engineering_inspiration','woodie_flowers','dean_list',
      'rookie_all_star','entrepreneurship','quality','innovation_in_control',
      'excellence_in_engineering','imagery','safety','other'
    )),
  award_name text NOT NULL,
  event_name text NOT NULL,
  event_date date,
  submission_deadline date,
  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','drafting','submitted','judging','won','not_won','withdrawn')),
  submitted_on date,
  owner_note text,
  notes text,
  season_year integer NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX award_tracker_submissions_org_season_idx
  ON award_tracker_submissions(org_id, season_year, submission_deadline);

ALTER TABLE award_tracker_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY award_tracker_submissions_member_read ON award_tracker_submissions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY award_tracker_submissions_member_insert ON award_tracker_submissions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY award_tracker_submissions_member_update ON award_tracker_submissions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY award_tracker_submissions_member_delete ON award_tracker_submissions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON award_tracker_submissions TO vantage_app, vantage_worker;
