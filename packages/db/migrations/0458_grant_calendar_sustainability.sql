-- Grant calendar + sustainability early warning.
--
-- Community evidence (docs/COMMUNITY_DEMAND_RND.md):
--   * "Is there a way to sign up for an email notification when the Boeing grant opens?"
--     — answer today is "no, lurk in forum threads". Teams need a MAINTAINED calendar with
--     open/close dates, eligibility filtering, and deadline alerts.
--   * "~50% of dead rookie teams had exactly one sponsor vs a median of 3-4 for survivors;
--     teams most commonly die 2 years after rookie season, when rookie grants expire."
--     The sustainability signal is computed at read time from rows the team already records
--     (finance_funding_sources 0434, sponsors/sponsor_contributions 0035, grant_applications
--     0036, memberships) — no denormalized score table, and never a score from thin data.
--
-- NOTE ON NAMING: `grant_opportunities` already exists (0036) as a strictly org-scoped
-- application-pipeline table with org_id NOT NULL. This calendar needs platform-curated rows
-- (org_id IS NULL) shared by every team, so it lands as its own table rather than loosening
-- 0036's tenancy invariant on a table other product surfaces already depend on.

CREATE TABLE grant_calendar_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = platform-curated row visible to every team. Non-NULL = one team's own addition.
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  funder text NOT NULL CHECK (char_length(funder) BETWEEN 1 AND 200),
  url text,
  opens_on date,
  closes_on date,
  typical_amount_usd numeric(12,2)
    CHECK (typical_amount_usd IS NULL OR typical_amount_usd >= 0),
  -- Structured eligibility rules. Every key optional; a key the team profile cannot answer
  -- yields an "unknown" match outcome, never a guessed eligible/ineligible.
  -- {
  --   "teamAgeMax": 3,            -- seasons since rookie_year (inclusive)
  --   "teamAgeMin": 1,
  --   "rookieOnly": true,         -- rookie season only
  --   "titleI": true,             -- team's school must be Title I
  --   "region": ["MA", "NH"],     -- organizations.state_prov / country match (any)
  --   "nonprofit501c3": true,     -- team holds its own 501(c)(3)
  --   "minStudentCount": 5,
  --   "minMentorCount": 1
  -- }
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  -- NULL only for platform-seeded rows loaded outside the product.
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grant_calendar_opportunities_window_chk
    CHECK (opens_on IS NULL OR closes_on IS NULL OR closes_on >= opens_on),
  CONSTRAINT grant_calendar_opportunities_eligibility_is_object
    CHECK (jsonb_typeof(eligibility) = 'object'),
  CONSTRAINT grant_calendar_opportunities_url_chk
    CHECK (url IS NULL OR url ~* '^https?://[^\s]{3,2000}$'),
  CONSTRAINT grant_calendar_opportunities_notes_len
    CHECK (notes IS NULL OR char_length(notes) <= 4000)
);
CREATE INDEX grant_calendar_opportunities_close_idx
  ON grant_calendar_opportunities (is_active, closes_on);
CREATE INDEX grant_calendar_opportunities_org_idx
  ON grant_calendar_opportunities (org_id, closes_on);

ALTER TABLE grant_calendar_opportunities ENABLE ROW LEVEL SECURITY;

-- Every authenticated member reads the platform calendar plus their own team's additions.
CREATE POLICY grant_calendar_opportunities_read
  ON grant_calendar_opportunities FOR SELECT TO vantage_app
  USING (
    (org_id IS NULL AND current_app_user_id() IS NOT NULL)
    OR (org_id IS NOT NULL AND is_org_member(org_id))
  );

-- Product code may only ever write ORG rows. Platform rows (org_id IS NULL) are admin-seeded
-- through the worker role; no request-path policy can create or mutate them.
CREATE POLICY grant_calendar_opportunities_org_insert
  ON grant_calendar_opportunities FOR INSERT TO vantage_app
  WITH CHECK (
    org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY grant_calendar_opportunities_org_update
  ON grant_calendar_opportunities FOR UPDATE TO vantage_app
  USING (org_id IS NOT NULL AND has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (org_id IS NOT NULL AND has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY grant_calendar_opportunities_org_delete
  ON grant_calendar_opportunities FOR DELETE TO vantage_app
  USING (org_id IS NOT NULL AND has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON grant_calendar_opportunities
  TO vantage_app, vantage_worker;

COMMENT ON TABLE grant_calendar_opportunities IS
  'Grant calendar. org_id IS NULL = platform-curated (seasonal curation is the product); '
  'org_id set = a single team''s own addition. Product code can never write platform rows.';

-- Per-member watch: who wants deadline alerts for which grant, for which team.
CREATE TABLE grant_calendar_watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL
    REFERENCES grant_calendar_opportunities(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notify boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grant_calendar_watchlist_uq UNIQUE (org_id, opportunity_id, member_user_id)
);
CREATE INDEX grant_calendar_watchlist_org_idx
  ON grant_calendar_watchlist (org_id, opportunity_id);
CREATE INDEX grant_calendar_watchlist_notify_idx
  ON grant_calendar_watchlist (notify, opportunity_id);

ALTER TABLE grant_calendar_watchlist ENABLE ROW LEVEL SECURITY;

-- The whole team sees who is watching what (so two mentors don't both chase one grant);
-- each member only creates and edits their OWN watch row.
CREATE POLICY grant_calendar_watchlist_member_read
  ON grant_calendar_watchlist FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY grant_calendar_watchlist_self_insert
  ON grant_calendar_watchlist FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND member_user_id = current_app_user_id());
CREATE POLICY grant_calendar_watchlist_self_update
  ON grant_calendar_watchlist FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND member_user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND member_user_id = current_app_user_id());
CREATE POLICY grant_calendar_watchlist_self_delete
  ON grant_calendar_watchlist FOR DELETE TO vantage_app
  USING (is_org_member(org_id) AND member_user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON grant_calendar_watchlist
  TO vantage_app, vantage_worker;

-- Idempotency ledger for the deadline alert job (mirrors sponsor_reminder_events, 0155):
-- one row per (org, grant, member, milestone, close date) so a re-run never double-sends.
CREATE TABLE grant_calendar_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL
    REFERENCES grant_calendar_opportunities(id) ON DELETE CASCADE,
  member_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  milestone_days integer NOT NULL CHECK (milestone_days IN (30, 14, 3)),
  closes_on date NOT NULL,
  notified_on date NOT NULL DEFAULT (CURRENT_DATE),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grant_calendar_alert_events_uq
    UNIQUE (org_id, opportunity_id, member_user_id, milestone_days, closes_on)
);
CREATE INDEX grant_calendar_alert_events_org_idx
  ON grant_calendar_alert_events (org_id, notified_on DESC);

ALTER TABLE grant_calendar_alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY grant_calendar_alert_events_member_read
  ON grant_calendar_alert_events FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT ON grant_calendar_alert_events TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON grant_calendar_alert_events TO vantage_worker;

COMMENT ON TABLE grant_calendar_alert_events IS
  'Write-once ledger claimed by the grant deadline alert worker (30/14/3 days before close). '
  'Request code reads only; the worker role writes.';

-- Two eligibility facts nothing else records. Both stay NULL until a mentor answers, and NULL
-- is what makes the matcher say "we don't know your Title I status" instead of guessing.
-- Existing 0162 owner/admin policies on this table already cover the writes.
ALTER TABLE team_background_profile
  ADD COLUMN IF NOT EXISTS title_i boolean,
  ADD COLUMN IF NOT EXISTS nonprofit_501c3 boolean;

COMMENT ON COLUMN team_background_profile.title_i IS
  'Title I school status. NULL = not recorded — the grant matcher reports "unknown", never a guess.';
COMMENT ON COLUMN team_background_profile.nonprofit_501c3 IS
  'Team holds its own 501(c)(3). NULL = not recorded.';

-- Defensive peer-insert policy for the alert notification type. The alert job runs as
-- vantage_worker (BYPASSRLS), so this only matters if the job is ever moved onto vantage_app.
DROP POLICY IF EXISTS notifications_grant_deadline_peer_insert ON notifications;
CREATE POLICY notifications_grant_deadline_peer_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'grant_deadline_approaching'
    AND org_id IS NOT NULL
    AND is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
    )
  );
