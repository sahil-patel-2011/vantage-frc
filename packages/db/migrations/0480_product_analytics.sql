-- First-party product analytics, opt-in, with nothing hidden in it.
--
-- WHY THIS TABLE EXISTS
--   We cannot tell which parts of Vantage teams actually use. Without that we
--   guess, and guessing is how a product grows six half-finished surfaces and
--   no working one. This records *which page or feature was used, by whom, in
--   which team, and when* — and deliberately nothing more.
--
-- WHAT THIS IS NOT — and the schema is the enforcement, not a promise:
--   * NOT anonymous. There is a real user_id and a real org_id. We say so in
--     the consent banner and in the privacy policy rather than hiding behind
--     the word "anonymous", because most of our users are minors and a vague
--     claim aimed at a fifteen-year-old is a lie with extra steps.
--   * NOT third-party. There is no advertising SDK, no cross-site pixel, no
--     session replay, and no device fingerprint. Rows land in this team's own
--     Postgres rows behind the same RLS as everything else.
--   * NOT location. There is no ip column, no geo column, no user-agent
--     column. `device_class` is a four-value bucket (phone/tablet/desktop/
--     unknown) derived on the client from viewport width. That is the whole
--     device signal. A column that does not exist cannot be quietly filled in
--     later without another migration and another policy review.
--   * NOT content. `path` is normalised before it is sent (query strings
--     dropped, id-shaped segments collapsed to `:id`) so a row can never carry
--     a search term, a student's name, or a record id. `meta` is a small,
--     size-capped object for counters and enum-ish labels.
--
-- OPT-IN IS ENFORCED IN THE REQUEST PATH, NOT HERE.
--   Postgres cannot see a browser cookie. POST /api/analytics/events refuses
--   to insert unless the request carries a granted analytics-consent cookie at
--   the current consent version. Declining leaves the product fully working —
--   nothing in the app reads this table to decide what a user may do.
--
-- RETENTION — RAW EVENTS ARE KEPT 180 DAYS.
--   Enforced by a cron-style purge, not by a comment:
--     POST /api/analytics/retention   (CRON_SECRET-authorised, worker role)
--     -> apps/web/lib/product-analytics/retention.ts
--   Point a daily scheduler at it. Owners/admins can also clear their own
--   team's rows early via the DELETE policy below. If the purge stops running
--   the rows simply accumulate — there is no silent partial deletion.

CREATE TABLE IF NOT EXISTS product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Closed vocabulary. An event name the product does not already ship is
  -- rejected by the database as well as by the route, so a future logging call
  -- cannot widen what we collect without a migration.
  -- Keep in sync with PRODUCT_EVENT_NAMES in
  -- apps/web/lib/product-analytics/events.ts (a test pins the list).
  event text NOT NULL CHECK (
    event IN (
      'page_view',
      'feature_open',
      'feature_action',
      'search_run',
      'export_run',
      'ai_invoked',
      'onboarding_step',
      'setup_blocked'
    )
  ),

  -- Route shape only: '/scouting', '/team/:id/hours'. Never a query string.
  path text NOT NULL DEFAULT '' CHECK (char_length(path) <= 200),

  -- The entire device signal we keep. Derived from viewport width client-side.
  device_class text NOT NULL DEFAULT 'unknown'
    CHECK (device_class IN ('phone', 'tablet', 'desktop', 'unknown')),

  -- Small labelled counters. Object-only and byte-capped so this cannot become
  -- a dumping ground for free text. octet_length(jsonb::text) is used instead
  -- of pg_column_size() because CHECK constraints require immutable functions.
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(meta) = 'object' AND octet_length(meta::text) <= 2048),

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE product_events IS
  'First-party, opt-in product usage events. Account-identified (never claimed anonymous). No IP, no user agent, no geolocation, no content. Raw rows purged after 180 days by /api/analytics/retention.';
COMMENT ON COLUMN product_events.device_class IS
  'Coarse bucket from viewport width: phone | tablet | desktop | unknown. The only device signal collected.';
COMMENT ON COLUMN product_events.path IS
  'Normalised route shape. Query strings dropped and id-shaped segments collapsed to :id before send, so no identifier or search term can ride along.';
COMMENT ON COLUMN product_events.meta IS
  'Small JSON object of enum-ish labels/counters, <= 2048 bytes. Never free text typed by a user.';

CREATE INDEX IF NOT EXISTS product_events_org_time_idx
  ON product_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_events_org_event_idx
  ON product_events(org_id, event, created_at DESC);
-- Drives the retention purge, which scans by age across every org.
CREATE INDEX IF NOT EXISTS product_events_created_at_idx
  ON product_events(created_at);

ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_events_insert ON product_events;
DROP POLICY IF EXISTS product_events_read ON product_events;
DROP POLICY IF EXISTS product_events_delete ON product_events;

-- A member may record only their own activity, only in a team they belong to.
-- There is no UPDATE policy: an event is a fact about a moment and is never
-- rewritten.
CREATE POLICY product_events_insert ON product_events
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

-- Reading is an owner/admin capability, because these rows name individual
-- members. A student cannot read their teammates' usage, and — deliberately —
-- there is NO platform-admin read policy here. Vantage-side product analysis
-- runs through the admin surface's own worker pool, which is audited there, so
-- cross-team reads never become an ambient property of the app role.
CREATE POLICY product_events_read ON product_events
  FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

-- A team can clear its own history before the 180-day purge reaches it.
CREATE POLICY product_events_delete ON product_events
  FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, DELETE ON product_events TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_events TO vantage_worker;
