-- 0463_push_subscriptions.sql
-- Web Push endpoints + the TBA Firehose webhook intake queue.
--
-- Why two tables in one migration: they are one pipeline. TBA POSTs an event to
-- `/api/webhooks/tba` (10-second response deadline), we durably record it in
-- `tba_webhook_events` and answer immediately; fan-out then turns that event into
-- in-app notifications plus Web Push messages to `push_subscriptions`.
--
-- push_subscriptions is USER-owned, not org-owned. A browser subscription belongs to
-- the person + that specific browser/device (endpoint is globally unique per browser
-- push service registration), and one person can be a member of several orgs. `org_id`
-- is a nullable HINT recording which team's workspace the subscription was created in
-- so fan-out can prefer the right device; it is never the authorization boundary.
-- Authorization for a push is "is this user still a member of the org that generated
-- the event", checked at fan-out time against `memberships`.

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  failed_at timestamptz
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id) WHERE failed_at IS NULL;
CREATE INDEX push_subscriptions_org_idx ON push_subscriptions(org_id) WHERE failed_at IS NULL;

COMMENT ON COLUMN push_subscriptions.endpoint IS
  'Push service URL from PushSubscription.endpoint. Globally unique per browser registration; re-subscribing the same browser upserts this row.';
COMMENT ON COLUMN push_subscriptions.failed_at IS
  'Set when the push service answered 404/410 (subscription gone). Rows are pruned outright on those codes; this column exists so a delete that races a concurrent send degrades to a skip instead of an error.';
COMMENT ON COLUMN push_subscriptions.org_id IS
  'Hint only: the workspace the browser was subscribed from. Never a permission check — fan-out re-verifies membership.';

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Self-managed: a member sees and manages only their own device registrations.
-- Nobody — not owners, not admins — can enumerate another member's devices.
CREATE POLICY push_subscriptions_self_read ON push_subscriptions FOR SELECT TO vantage_app
  USING (user_id = current_app_user_id());
CREATE POLICY push_subscriptions_self_insert ON push_subscriptions FOR INSERT TO vantage_app
  WITH CHECK (user_id = current_app_user_id());
CREATE POLICY push_subscriptions_self_update ON push_subscriptions FOR UPDATE TO vantage_app
  USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());
CREATE POLICY push_subscriptions_self_delete ON push_subscriptions FOR DELETE TO vantage_app
  USING (user_id = current_app_user_id());

-- Worker fan-out reads every subscription and prunes dead ones (404/410).
GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO vantage_app;
GRANT SELECT, UPDATE, DELETE ON push_subscriptions TO vantage_worker;

-- ---------------------------------------------------------------------------
-- TBA Firehose intake queue.
--
-- One platform-level TBA webhook subscription covers every event; we fan out by org
-- internally. The row is written inside the request (HMAC already verified) so the
-- 200 can go back inside TBA's 10-second deadline, and processing happens after the
-- response — or on the drain endpoint if the request was killed mid-flight.
CREATE TABLE tba_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type text NOT NULL,
  message_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  notified_count integer NOT NULL DEFAULT 0
);

CREATE INDEX tba_webhook_events_pending_idx
  ON tba_webhook_events(received_at) WHERE processed_at IS NULL;
CREATE INDEX tba_webhook_events_type_idx ON tba_webhook_events(message_type, received_at DESC);

COMMENT ON TABLE tba_webhook_events IS
  'Raw TBA Firehose deliveries. Platform-level (no org_id) — one subscription serves every team; fan-out resolves orgs from org_active_context at processing time.';

ALTER TABLE tba_webhook_events ENABLE ROW LEVEL SECURITY;

-- No vantage_app write path at all: only the worker role (webhook handler / drain)
-- writes here. Platform admins may read for operational debugging.
CREATE POLICY tba_webhook_events_platform_admin_read ON tba_webhook_events FOR SELECT TO vantage_app
  USING (is_platform_admin());

GRANT SELECT ON tba_webhook_events TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tba_webhook_events TO vantage_worker;
