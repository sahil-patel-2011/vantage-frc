-- Org-scoped team location + short description for team-head onboarding
-- and Team settings. Never shared across organizations.
-- Also creates team_background_profile for sponsorship / grant "who we are"
-- (owners/admins edit; members read). Additive / IF NOT EXISTS safe.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state_prov text,
  ADD COLUMN IF NOT EXISTS description text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_city_len'
      AND conrelid = 'organizations'::regclass
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_city_len
      CHECK (city IS NULL OR char_length(city) BETWEEN 1 AND 120);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_state_prov_len'
      AND conrelid = 'organizations'::regclass
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_state_prov_len
      CHECK (state_prov IS NULL OR char_length(state_prov) BETWEEN 1 AND 80);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_description_len'
      AND conrelid = 'organizations'::regclass
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_description_len
      CHECK (description IS NULL OR char_length(description) <= 2000);
  END IF;
END $$;

-- Owners/admins may update THIS org's profile fields from Team settings.
DROP POLICY IF EXISTS organizations_admin_profile_update ON organizations;
CREATE POLICY organizations_admin_profile_update ON organizations
  FOR UPDATE TO vantage_app
  USING (has_org_role(id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(id, ARRAY['owner', 'admin']::org_role[]));

CREATE TABLE IF NOT EXISTS team_background_profile (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  mission text,
  history text,
  demographics text,
  achievements jsonb NOT NULL DEFAULT '[]'::jsonb,
  student_count integer CHECK (student_count IS NULL OR student_count >= 0),
  mentor_count integer CHECK (mentor_count IS NULL OR mentor_count >= 0),
  founded_year integer CHECK (founded_year IS NULL OR (founded_year BETWEEN 1992 AND 3000)),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_background_mission_len CHECK (mission IS NULL OR char_length(mission) <= 2000),
  CONSTRAINT team_background_history_len CHECK (history IS NULL OR char_length(history) <= 8000),
  CONSTRAINT team_background_demographics_len CHECK (demographics IS NULL OR char_length(demographics) <= 4000),
  CONSTRAINT team_background_achievements_is_array CHECK (jsonb_typeof(achievements) = 'array')
);

ALTER TABLE team_background_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_background_member_read ON team_background_profile;
DROP POLICY IF EXISTS team_background_admin_insert ON team_background_profile;
DROP POLICY IF EXISTS team_background_admin_update ON team_background_profile;
DROP POLICY IF EXISTS team_background_admin_delete ON team_background_profile;

CREATE POLICY team_background_member_read ON team_background_profile
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY team_background_admin_insert ON team_background_profile
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY team_background_admin_update ON team_background_profile
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY team_background_admin_delete ON team_background_profile
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON team_background_profile TO vantage_app, vantage_worker;
