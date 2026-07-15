-- First-login onboarding profile fields. DOB/gender are private (self + platform admin read).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text,
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS preferred_team_number integer,
  ADD COLUMN IF NOT EXISTS team_role text,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_gender_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_gender_check
  CHECK (gender IS NULL OR gender IN ('female','male','non_binary','prefer_not_to_say','other'));

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_team_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_team_role_check
  CHECK (team_role IS NULL OR team_role IN ('student','mentor','coach','parent','other'));

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_preferred_team_number_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_preferred_team_number_check
  CHECK (preferred_team_number IS NULL OR preferred_team_number BETWEEN 1 AND 99999);

CREATE INDEX IF NOT EXISTS profiles_onboarding_completed_idx
  ON profiles (onboarding_completed_at)
  WHERE onboarding_completed_at IS NULL;

-- Platform admins may read profiles (including sensitive demographic fields) for support.
DROP POLICY IF EXISTS profiles_platform_admin_read ON profiles;
CREATE POLICY profiles_platform_admin_read ON profiles FOR SELECT TO vantage_app
  USING (is_platform_admin());
