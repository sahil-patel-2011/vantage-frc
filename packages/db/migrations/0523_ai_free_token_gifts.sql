-- Gifted AI tokens, separate from request credits.
--
-- A platform admin can hand a team a token allowance from a chosen source
-- (Freebuff, hosted keys, or request credits). Balance is always SUM(ledger).
-- Freebuff gifts are what the team sees as "free tokens" — not credits.

CREATE TABLE ai_free_token_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('freebuff', 'hosted_platform', 'credits')),
  entry_kind text NOT NULL CHECK (entry_kind IN ('grant', 'consumption')),
  tokens bigint NOT NULL CHECK (tokens <> 0),
  feature text,
  request_id text UNIQUE,
  expires_at timestamptz,
  actor_user_id uuid REFERENCES users(id),
  reason text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (entry_kind <> 'grant' OR tokens > 0),
  CHECK (entry_kind = 'grant' OR tokens < 0),
  CHECK (entry_kind = 'grant' OR expires_at IS NULL)
);
CREATE INDEX ai_free_token_ledger_org_created_idx
  ON ai_free_token_ledger(org_id, created_at DESC);
CREATE INDEX ai_free_token_ledger_org_source_idx
  ON ai_free_token_ledger(org_id, source, created_at DESC);

CREATE VIEW org_ai_free_tokens WITH (security_invoker = true) AS
SELECT
  l.org_id,
  l.source,
  COALESCE(SUM(l.tokens) FILTER (
    WHERE l.entry_kind = 'grant' AND (l.expires_at IS NULL OR l.expires_at > now())
  ), 0)::bigint AS granted,
  COALESCE(-SUM(l.tokens) FILTER (WHERE l.entry_kind <> 'grant'), 0)::bigint AS spent,
  COALESCE(SUM(l.tokens) FILTER (
    WHERE l.entry_kind <> 'grant'
       OR l.expires_at IS NULL
       OR l.expires_at > now()
  ), 0)::bigint AS balance
FROM ai_free_token_ledger l
GROUP BY l.org_id, l.source;

ALTER TABLE ai_free_token_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_free_token_member_read ON ai_free_token_ledger FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY ai_free_token_platform_read ON ai_free_token_ledger FOR SELECT TO vantage_app
  USING (is_platform_admin());
CREATE POLICY ai_free_token_platform_grant ON ai_free_token_ledger FOR INSERT TO vantage_app
  WITH CHECK (is_platform_admin() AND actor_user_id = current_app_user_id());
CREATE POLICY ai_free_token_member_consume ON ai_free_token_ledger FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND entry_kind = 'consumption'
    AND tokens < 0
  );
CREATE POLICY ai_free_token_worker ON ai_free_token_ledger FOR ALL TO vantage_worker
  USING (true) WITH CHECK (true);

GRANT SELECT, INSERT ON ai_free_token_ledger TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_free_token_ledger TO vantage_worker;
GRANT SELECT ON org_ai_free_tokens TO vantage_app, vantage_worker;
