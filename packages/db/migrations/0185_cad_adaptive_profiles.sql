-- Team manufacturing knowledge improves CAD output; communication preferences remain
-- private to one user and are never readable by teammates or embedded in shared jobs.
CREATE TABLE cad_team_profiles (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  default_platform text NOT NULL DEFAULT 'onshape'
    CHECK (default_platform IN ('onshape','fusion360','mock')),
  preferred_units text NOT NULL DEFAULT 'mm'
    CHECK (preferred_units IN ('mm','in')),
  manufacturing_processes text[] NOT NULL DEFAULT '{}',
  preferred_materials text[] NOT NULL DEFAULT '{}',
  standard_components text[] NOT NULL DEFAULT '{}',
  design_rules text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cad_user_preferences (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  response_style text NOT NULL DEFAULT 'teaching'
    CHECK (response_style IN ('concise','teaching','expert')),
  explanation_depth text NOT NULL DEFAULT 'standard'
    CHECK (explanation_depth IN ('minimal','standard','deep')),
  preferred_units text NOT NULL DEFAULT 'team'
    CHECK (preferred_units IN ('team','mm','in')),
  preferred_platform text
    CHECK (preferred_platform IS NULL OR preferred_platform IN ('onshape','fusion360','mock')),
  custom_instructions text NOT NULL DEFAULT '' CHECK (length(custom_instructions) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,user_id)
);

ALTER TABLE cad_team_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cad_user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY cad_team_profiles_member_read ON cad_team_profiles FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY cad_team_profiles_admin_insert ON cad_team_profiles FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
CREATE POLICY cad_team_profiles_admin_update ON cad_team_profiles FOR UPDATE TO vantage_app
  USING (has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id,ARRAY['owner','admin']::org_role[]));

CREATE POLICY cad_user_preferences_private_read ON cad_user_preferences FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND user_id=current_app_user_id());
CREATE POLICY cad_user_preferences_private_insert ON cad_user_preferences FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id=current_app_user_id());
CREATE POLICY cad_user_preferences_private_update ON cad_user_preferences FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id=current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id=current_app_user_id());
CREATE POLICY cad_user_preferences_private_delete ON cad_user_preferences FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND user_id=current_app_user_id());

GRANT SELECT,INSERT,UPDATE ON cad_team_profiles TO vantage_app,vantage_worker;
GRANT SELECT,INSERT,UPDATE,DELETE ON cad_user_preferences TO vantage_app,vantage_worker;
