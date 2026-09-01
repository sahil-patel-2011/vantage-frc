-- In-flight AI cost reservations, so a streamed response counts against caps while it
-- is still being produced.
--
-- Until now the model call ran inside the same transaction as the cap check, so a
-- request was either uncommitted-and-in-flight or committed-to-ai_usage_events, and
-- summing that table was a complete picture of spend. A streamed response breaks that:
-- the route must return a Response before the token count exists, so authorize commits
-- and settle happens later from a different transaction. Between those two points the
-- request is invisible — it is in no ledger and holds no lock.
--
-- Two things go wrong without a durable record of that window:
--   1. Caps under-count. Ten concurrent streams each see zero in-flight spend and each
--      pass a cap that only one of them should have.
--   2. The idempotency claim evaporates. meteredAI's pg_advisory_xact_lock on the
--      request id is TRANSACTION-scoped, so it releases the moment authorize commits,
--      and a retry of the same request_id would sail through.
--
-- A reservation row fixes both: the UNIQUE request_id is a durable duplicate claim that
-- outlives the authorizing transaction, and unsettled rows are added to committed usage
-- when checking caps.
--
-- ai_usage_events stays append-only and dollar-exact. Reservations are ESTIMATES and
-- live in their own table precisely so no existing SUM(cost_usd) starts including
-- guesses.

CREATE TABLE ai_usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  feature text NOT NULL,
  -- Same idempotency key as ai_usage_events.request_id. UNIQUE is the durable
  -- replacement for the transaction-scoped advisory lock.
  request_id text NOT NULL UNIQUE,
  estimated_cost_usd numeric(12,6) NOT NULL CHECK (estimated_cost_usd >= 0),
  key_source text NOT NULL,
  -- A client that disconnects mid-stream never settles. Rather than trust a reaper to
  -- run, the cap sum ignores rows past their expiry, so an abandoned reservation stops
  -- consuming budget on its own.
  expires_at timestamptz NOT NULL,
  settled_at timestamptz,
  released_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (settled_at IS NULL OR released_at IS NULL)
);

-- Drives the cap sum: open reservations for one org.
CREATE INDEX ai_usage_reservations_org_open_idx
  ON ai_usage_reservations (org_id, expires_at)
  WHERE settled_at IS NULL AND released_at IS NULL;

CREATE INDEX ai_usage_reservations_created_idx
  ON ai_usage_reservations (created_at DESC);

ALTER TABLE ai_usage_reservations ENABLE ROW LEVEL SECURITY;

-- A team may see its own in-flight spend; the metering path writes under the worker
-- role. No member INSERT policy: a reservation is only ever created by the billing
-- code, never by a client asserting its own budget hold.
CREATE POLICY ai_usage_reservations_member_read ON ai_usage_reservations
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY ai_usage_reservations_platform_read ON ai_usage_reservations
  FOR SELECT TO vantage_app
  USING (is_platform_admin());

-- The app role authorizes and settles inside a member request, so it needs INSERT and
-- UPDATE — but only for an org it belongs to, and only for its own reservations.
CREATE POLICY ai_usage_reservations_member_write ON ai_usage_reservations
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));

CREATE POLICY ai_usage_reservations_member_settle ON ai_usage_reservations
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY ai_usage_reservations_worker ON ai_usage_reservations
  FOR ALL TO vantage_worker
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON ai_usage_reservations TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_usage_reservations TO vantage_worker;
