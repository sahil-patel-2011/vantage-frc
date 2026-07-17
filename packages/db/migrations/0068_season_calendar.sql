-- Season Calendar & Milestones.
-- The FRC build season runs ~8 weeks from Kickoff through competitions. Teams
-- seed a standard build-season milestone template relative to their kickoff
-- date, add custom milestones (events, deadlines, meetings, outreach), track
-- countdowns, and check milestones off as the season progresses.

CREATE TABLE season_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'build'
    CHECK (kind IN ('kickoff', 'design', 'build', 'practice', 'event', 'deadline', 'meeting', 'outreach', 'other')),
  starts_on date NOT NULL,
  ends_on date CHECK (ends_on IS NULL OR ends_on >= starts_on),
  notes text NOT NULL DEFAULT '',
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX season_milestones_org_idx ON season_milestones(org_id, starts_on);

ALTER TABLE season_milestones ENABLE ROW LEVEL SECURITY;

-- The season plan is a whole-team artifact: members read/write; milestone
-- deletion is limited to the creator or an owner/admin.
CREATE POLICY season_milestones_read ON season_milestones FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY season_milestones_insert ON season_milestones FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_milestones_update ON season_milestones FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_milestones_delete ON season_milestones FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON season_milestones TO vantage_app, vantage_worker;
