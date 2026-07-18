-- Alumni network directory: alumni profiles + mentor availability windows.
-- Lets a team track graduated members who remain reachable as mentors, and log
-- mentor-availability windows those alumni have offered (topic, dates, status).

CREATE TABLE alumni_network_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  graduation_year integer,
  role_while_active text,
  current_occupation text,
  current_location text,
  email text,
  phone text,
  linkedin_url text,
  mentor_available boolean NOT NULL DEFAULT false,
  mentor_focus_areas text[] NOT NULL DEFAULT '{}',
  bio text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alumni_network_profiles_org_idx ON alumni_network_profiles(org_id, status, full_name);

ALTER TABLE alumni_network_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY alumni_network_profiles_member_read ON alumni_network_profiles FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY alumni_network_profiles_member_insert ON alumni_network_profiles FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND added_by = current_app_user_id());
CREATE POLICY alumni_network_profiles_member_update ON alumni_network_profiles FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY alumni_network_profiles_member_delete ON alumni_network_profiles FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON alumni_network_profiles TO vantage_app, vantage_worker;

CREATE TABLE alumni_network_mentor_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES alumni_network_profiles(id) ON DELETE CASCADE,
  topic text NOT NULL,
  available_from date NOT NULL,
  available_to date,
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'booked', 'completed', 'cancelled')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alumni_network_mentor_slots_org_idx ON alumni_network_mentor_slots(org_id, status, available_from DESC);
CREATE INDEX alumni_network_mentor_slots_profile_idx ON alumni_network_mentor_slots(profile_id);

ALTER TABLE alumni_network_mentor_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY alumni_network_mentor_slots_member_read ON alumni_network_mentor_slots FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY alumni_network_mentor_slots_member_insert ON alumni_network_mentor_slots FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY alumni_network_mentor_slots_member_update ON alumni_network_mentor_slots FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY alumni_network_mentor_slots_member_delete ON alumni_network_mentor_slots FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON alumni_network_mentor_slots TO vantage_app, vantage_worker;
