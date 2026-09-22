-- Named permission profiles a team defines for itself.
--
-- Vantage already had the two halves of "what may this person do": the four
-- built-in roles (owner/admin/scout/viewer), the capability grants in
-- membership_capabilities, and the hub/tab allowlists in membership_hub_access.
-- What it did not have is a *name* for a combination. Every team has a "team
-- lead" or a "drive coach" or a "business captain", and setting one up meant an
-- admin remembering which capability checkboxes and which hub allowlist that
-- person is supposed to get — by hand, per member, with no way to see that two
-- leads were configured differently.
--
-- A profile is that combination, stored once and applied to members. It is
-- deliberately NOT a new enforcement path: applying a profile writes the same
-- memberships.role, membership_capabilities and membership_hub_access rows an
-- admin would have set by hand, so every existing RLS policy and every
-- assertOrgCapability / assertHubTabAccess call keeps being the thing that
-- decides access. A profile that stopped matching those rows would be a lie, so
-- there is nothing here to read at request time.

CREATE TABLE org_role_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Stable slug so the UI (and a future import) can refer to a profile without
  -- its display name; teams rename "Team lead" to "Captain" all the time.
  key text NOT NULL CHECK (key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(key) <= 40),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 280),
  -- The role a member gets when this profile is applied. Owner is excluded:
  -- ownership is transferred, never handed out by a preset.
  base_role org_role NOT NULL DEFAULT 'scout' CHECK (base_role <> 'owner'),
  capabilities org_capability[] NOT NULL DEFAULT '{}',
  -- {"competition": ["scouting"], "team": []} — a hub with an empty array means
  -- the whole hub. An empty object means unrestricted, matching the "no rows in
  -- membership_hub_access" convention.
  hub_access jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(hub_access) = 'object'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE INDEX org_role_profiles_org_idx ON org_role_profiles (org_id, name);

ALTER TABLE org_role_profiles ENABLE ROW LEVEL SECURITY;

-- Every member may read the profiles: "what is a Team lead allowed to do" is a
-- question a student should be able to answer without asking an admin.
CREATE POLICY org_role_profiles_member_read ON org_role_profiles
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id) OR is_platform_admin());

CREATE POLICY org_role_profiles_admin_write ON org_role_profiles
  FOR ALL TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR is_platform_admin()
  )
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR is_platform_admin()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON org_role_profiles TO vantage_app, vantage_worker;

COMMENT ON TABLE org_role_profiles IS
  'Team-defined permission profiles (Team lead, Drive coach, custom). Applying one writes the ordinary role/capability/hub-access rows; nothing reads this table to authorize a request.';
