-- Roles & Responsibilities: the team's roles (leads and positions) by subteam, who holds each,
-- and what they own. The app derives staffing coverage. Season-scoped, per-org RLS.

CREATE TABLE team_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL,
  subteam text NOT NULL DEFAULT 'other'
    CHECK (subteam IN ('mechanical','electrical','programming','cad','controls','business','drive_team','scouting','media','safety','other')),
  holder_name text,
  is_lead boolean NOT NULL DEFAULT false,
  responsibilities text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_roles_org_season_idx ON team_roles(org_id, season_year, subteam);

ALTER TABLE team_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_roles_member_read ON team_roles FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY team_roles_member_insert ON team_roles FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY team_roles_member_update ON team_roles FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY team_roles_member_delete ON team_roles FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON team_roles TO vantage_app, vantage_worker;
