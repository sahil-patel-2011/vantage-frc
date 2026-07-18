-- Role-based onboarding checklists (CD #28).
-- Personal Soft-UI paths on /start: tracks auto-assigned from team_role,
-- primary_focus, and fuzzy match of calendar subteam names. Templates live in
-- apps/web/lib/role-onboarding/; this migration stores per-member progress only.
-- No seeded demo checklist rows.

CREATE TABLE IF NOT EXISTS member_onboarding_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_key text NOT NULL,
  source text NOT NULL
    CHECK (source IN ('welcome', 'role', 'focus', 'subteam', 'manual')),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  UNIQUE (org_id, user_id, track_key)
);

CREATE INDEX IF NOT EXISTS member_onboarding_tracks_user_idx
  ON member_onboarding_tracks(org_id, user_id, assigned_at DESC);

CREATE TABLE IF NOT EXISTS member_onboarding_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_key text NOT NULL,
  check_key text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, track_key, check_key)
);

CREATE INDEX IF NOT EXISTS member_onboarding_checks_user_idx
  ON member_onboarding_checks(org_id, user_id, track_key);

ALTER TABLE member_onboarding_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_onboarding_checks ENABLE ROW LEVEL SECURITY;

-- Members read/write only their own checklist progress inside orgs they belong to.
CREATE POLICY member_onboarding_tracks_select ON member_onboarding_tracks
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY member_onboarding_tracks_insert ON member_onboarding_tracks
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY member_onboarding_tracks_update ON member_onboarding_tracks
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY member_onboarding_tracks_delete ON member_onboarding_tracks
  FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY member_onboarding_checks_select ON member_onboarding_checks
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY member_onboarding_checks_insert ON member_onboarding_checks
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY member_onboarding_checks_update ON member_onboarding_checks
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY member_onboarding_checks_delete ON member_onboarding_checks
  FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON member_onboarding_tracks TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON member_onboarding_checks TO vantage_app, vantage_worker;
