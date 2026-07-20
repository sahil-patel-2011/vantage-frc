-- Grant Eligibility Matcher & Deadline Radar: a platform-maintained, admin-editable catalog of
-- grants (BAE, NASA, Boeing, Dow, etc.) with structured eligibility rules, matched against each
-- team's own profile fields (rookie status via teams_ref.rookie_year, region via organizations
-- city/state_prov, mentor employers, demographics via team_background_profile) into a per-org
-- scored matches table. Distinct from grant-report (post-award compliance): this is discovery —
-- surfacing only grants the team's recorded profile actually qualifies for, with deadline dates
-- that a scheduled job can flag into notifications/tasks.

-- Platform-maintained reference catalog: not org-scoped, mirrors the teams_ref reference-table
-- pattern (0002_global_reference.sql) — every authenticated member may read it; only platform
-- admins may edit it from an admin surface; the worker role can also write for ingest jobs.
CREATE TABLE grant_eligibility_matcher_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  funder text NOT NULL,
  description text,
  amount_min integer CHECK (amount_min IS NULL OR amount_min >= 0),
  amount_max integer CHECK (amount_max IS NULL OR amount_max >= 0),
  application_url text,
  -- Structured eligibility rules, evaluated against the team profile snapshot. All keys optional.
  -- {
  --   "maxRookieYears": 3,                       -- team must be within N years of rookie_year
  --   "regions": ["US", "CA"],                    -- allowed country/state_prov codes (any match)
  --   "mentorEmployers": ["Boeing", "BAE Systems"],-- team must record a mentor at one of these
  --   "requiresDemographicsFocus": true,           -- team_background_profile.demographics non-empty
  --   "minStudentCount": 5,
  --   "minMentorCount": 1
  -- }
  eligibility_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  deadline_type text NOT NULL DEFAULT 'fixed_date'
    CHECK (deadline_type IN ('fixed_date', 'rolling', 'season_open')),
  deadline_date date,
  season_year integer,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grant_eligibility_matcher_catalog_rules_is_object
    CHECK (jsonb_typeof(eligibility_rules) = 'object')
);
CREATE INDEX grant_eligibility_matcher_catalog_active_idx
  ON grant_eligibility_matcher_catalog(is_active, deadline_date);

ALTER TABLE grant_eligibility_matcher_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY grant_eligibility_matcher_catalog_authenticated_read
  ON grant_eligibility_matcher_catalog FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY grant_eligibility_matcher_catalog_admin_insert
  ON grant_eligibility_matcher_catalog FOR INSERT TO vantage_app
  WITH CHECK (is_platform_admin());
CREATE POLICY grant_eligibility_matcher_catalog_admin_update
  ON grant_eligibility_matcher_catalog FOR UPDATE TO vantage_app
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY grant_eligibility_matcher_catalog_admin_delete
  ON grant_eligibility_matcher_catalog FOR DELETE TO vantage_app
  USING (is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON grant_eligibility_matcher_catalog TO vantage_app, vantage_worker;

-- Org-scoped extra eligibility inputs not already captured elsewhere (mentor employers list).
-- Region, rookie year, student/mentor counts, and demographics narrative are read live from
-- organizations / teams_ref / team_background_profile — this table only adds what nothing else
-- records: the employers of the team's mentors, used to match employer-matching-gift grants.
CREATE TABLE grant_eligibility_matcher_profile (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  mentor_employers text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE grant_eligibility_matcher_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY grant_eligibility_matcher_profile_member_read
  ON grant_eligibility_matcher_profile FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY grant_eligibility_matcher_profile_member_insert
  ON grant_eligibility_matcher_profile FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY grant_eligibility_matcher_profile_member_update
  ON grant_eligibility_matcher_profile FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY grant_eligibility_matcher_profile_member_delete
  ON grant_eligibility_matcher_profile FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON grant_eligibility_matcher_profile TO vantage_app, vantage_worker;

-- Per-org computed matches: one row per (org, grant) once scored, with the eligibility outcome
-- and score snapshotted so the deadline-radar job and notifications can read a stable record
-- instead of recomputing eligibility on every poll.
CREATE TABLE grant_eligibility_matcher_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  grant_id uuid NOT NULL REFERENCES grant_eligibility_matcher_catalog(id) ON DELETE CASCADE,
  is_eligible boolean NOT NULL,
  score integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  matched_reasons text[] NOT NULL DEFAULT '{}',
  unmet_reasons text[] NOT NULL DEFAULT '{}',
  deadline_flagged_at timestamptz,
  dismissed_at timestamptz,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, grant_id)
);
CREATE INDEX grant_eligibility_matcher_matches_org_idx
  ON grant_eligibility_matcher_matches(org_id, is_eligible, score DESC);

ALTER TABLE grant_eligibility_matcher_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY grant_eligibility_matcher_matches_member_read
  ON grant_eligibility_matcher_matches FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY grant_eligibility_matcher_matches_member_insert
  ON grant_eligibility_matcher_matches FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY grant_eligibility_matcher_matches_member_update
  ON grant_eligibility_matcher_matches FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY grant_eligibility_matcher_matches_member_delete
  ON grant_eligibility_matcher_matches FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON grant_eligibility_matcher_matches TO vantage_app, vantage_worker;
