-- Drive-team qualitative tags (Pairwise 2.0-style). Org-scoped labels on FRC
-- team numbers at an event. Empty until someone applies a real tag — never DEMO robots.

CREATE TABLE qualitative_tag_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2000 AND 3000),
  slug text NOT NULL,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, slug),
  CONSTRAINT qualitative_tag_defs_slug_chk CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$')
);
CREATE INDEX qualitative_tag_defs_org_season_idx
  ON qualitative_tag_defs (org_id, season_year, sort_order);

CREATE TABLE qualitative_team_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2000 AND 3000),
  tag_id uuid NOT NULL REFERENCES qualitative_tag_defs(id) ON DELETE CASCADE,
  team_number integer NOT NULL CHECK (team_number BETWEEN 1 AND 99999),
  event_key text,
  match_key text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE qualitative_team_tags
  ADD CONSTRAINT qualitative_team_tags_once_uq
  UNIQUE NULLS NOT DISTINCT (org_id, season_year, tag_id, team_number, event_key, match_key);
CREATE INDEX qualitative_team_tags_org_team_idx
  ON qualitative_team_tags (org_id, season_year, team_number);

ALTER TABLE qualitative_tag_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualitative_team_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY qualitative_tag_defs_member_read ON qualitative_tag_defs
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY qualitative_tag_defs_member_insert ON qualitative_tag_defs
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY qualitative_tag_defs_admin_write ON qualitative_tag_defs
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY qualitative_team_tags_member_read ON qualitative_team_tags
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY qualitative_team_tags_member_insert ON qualitative_team_tags
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY qualitative_team_tags_self_delete ON qualitative_team_tags
  FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id());
CREATE POLICY qualitative_team_tags_admin_write ON qualitative_team_tags
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON qualitative_tag_defs, qualitative_team_tags
  TO vantage_app, vantage_worker;
