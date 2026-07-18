-- Cross-team scrim scheduling & shared-data agreements: proposed scrimmage matches with nearby
-- teams (date/location/status) and the accompanying data-sharing agreement (whether match/scouting
-- data collected during the scrim will be exchanged, and on what terms).

CREATE TABLE cross_team_scrim_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  partner_team_number integer NOT NULL,
  partner_team_name text,
  contact_name text,
  contact_email text,
  proposed_date date,
  location text,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','accepted','declined','scheduled','completed','cancelled')),
  data_share_scope text NOT NULL DEFAULT 'none'
    CHECK (data_share_scope IN ('none','match_results','full_scouting','video_only')),
  data_share_agreed boolean NOT NULL DEFAULT false,
  notes text,
  season_year integer NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cross_team_scrim_invites_org_season_idx
  ON cross_team_scrim_invites(org_id, season_year, proposed_date);

ALTER TABLE cross_team_scrim_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY cross_team_scrim_invites_member_read ON cross_team_scrim_invites FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY cross_team_scrim_invites_member_insert ON cross_team_scrim_invites FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY cross_team_scrim_invites_member_update ON cross_team_scrim_invites FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY cross_team_scrim_invites_member_delete ON cross_team_scrim_invites FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON cross_team_scrim_invites TO vantage_app, vantage_worker;
