ALTER TABLE model_catalog ADD COLUMN funding_mode text NOT NULL DEFAULT 'managed_paid'
  CHECK (funding_mode IN ('managed_paid','byok','local','sponsored'));
ALTER TABLE model_catalog ADD COLUMN commercial_use_approved boolean NOT NULL DEFAULT false;
ALTER TABLE model_catalog ADD COLUMN commercial_approval_source text;
ALTER TABLE model_catalog ADD COLUMN commercial_approval_reviewed_at timestamptz;
ALTER TABLE model_catalog ADD COLUMN provider_rate_limit_rpm integer CHECK (provider_rate_limit_rpm IS NULL OR provider_rate_limit_rpm > 0);
ALTER TABLE model_catalog ADD COLUMN provider_concurrency_limit integer CHECK (provider_concurrency_limit IS NULL OR provider_concurrency_limit > 0);
ALTER TABLE model_catalog ADD COLUMN sponsored_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE model_catalog ADD CONSTRAINT sponsored_model_governance_ck CHECK (
  funding_mode <> 'sponsored' OR sponsored_enabled = false OR (
    commercial_use_approved AND commercial_approval_source IS NOT NULL
    AND commercial_approval_reviewed_at IS NOT NULL
    AND provider_rate_limit_rpm IS NOT NULL AND provider_concurrency_limit IS NOT NULL
  )
);
ALTER TABLE model_catalog ADD CONSTRAINT base44_not_generic_customer_router_ck
  CHECK (lower(provider) <> 'base44' OR enabled = false);

CREATE TABLE platform_free_ai_policy (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  enabled boolean NOT NULL DEFAULT false,
  sponsored_model_id uuid REFERENCES model_catalog(id) ON DELETE SET NULL,
  monthly_allowance_usd numeric(12,6) NOT NULL DEFAULT 0 CHECK (monthly_allowance_usd >= 0),
  org_daily_request_limit integer NOT NULL DEFAULT 0 CHECK (org_daily_request_limit >= 0),
  user_daily_request_limit integer NOT NULL DEFAULT 0 CHECK (user_daily_request_limit >= 0),
  ip_daily_request_limit integer NOT NULL DEFAULT 0 CHECK (ip_daily_request_limit >= 0),
  concurrency_limit integer NOT NULL DEFAULT 1 CHECK (concurrency_limit >= 1),
  priority integer NOT NULL DEFAULT 0 CHECK (priority <= 0),
  require_verified_email boolean NOT NULL DEFAULT true,
  require_closed_team_membership boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (enabled = false OR (
    sponsored_model_id IS NOT NULL AND monthly_allowance_usd > 0
    AND org_daily_request_limit > 0 AND user_daily_request_limit > 0 AND ip_daily_request_limit > 0
  ))
);
INSERT INTO platform_free_ai_policy(id) VALUES ('default');

CREATE TABLE sponsored_ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES model_catalog(id),
  request_id text NOT NULL UNIQUE,
  ip_hash text NOT NULL,
  provider_cost_usd numeric(12,6) NOT NULL CHECK (provider_cost_usd >= 0),
  status text NOT NULL CHECK (status IN ('completed','denied','failed')),
  denial_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsored_ai_usage_org_created_idx ON sponsored_ai_usage_events(org_id,created_at);
CREATE INDEX sponsored_ai_usage_user_created_idx ON sponsored_ai_usage_events(user_id,created_at);
CREATE INDEX sponsored_ai_usage_ip_created_idx ON sponsored_ai_usage_events(ip_hash,created_at);

ALTER TABLE platform_free_ai_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsored_ai_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY free_ai_policy_platform_admin ON platform_free_ai_policy FOR ALL TO vantage_app
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());
CREATE POLICY sponsored_usage_platform_admin ON sponsored_ai_usage_events FOR SELECT TO vantage_app
  USING (is_platform_admin());
CREATE POLICY sponsored_usage_worker_write ON sponsored_ai_usage_events FOR ALL TO vantage_worker
  USING (true) WITH CHECK (true);

CREATE VIEW free_ai_economics WITH (security_invoker = true) AS
SELECT
  date_trunc('month', now()) AS period_start,
  COALESCE(sum(s.provider_cost_usd) FILTER (WHERE s.status='completed'),0) AS sponsored_provider_cost_usd,
  count(*) FILTER (WHERE s.status='completed') AS sponsored_completed_requests,
  count(*) FILTER (WHERE s.status='denied') AS sponsored_denied_requests,
  count(DISTINCT s.org_id) FILTER (WHERE s.status='completed') AS sponsored_active_orgs,
  (SELECT count(*) FROM org_billing b WHERE b.tier='free') AS free_orgs,
  (SELECT count(*) FROM org_billing b WHERE b.tier<>'free') AS converted_paid_orgs,
  p.enabled,
  p.monthly_allowance_usd,
  p.org_daily_request_limit,
  p.user_daily_request_limit,
  p.ip_daily_request_limit,
  p.concurrency_limit
FROM platform_free_ai_policy p
LEFT JOIN sponsored_ai_usage_events s ON s.created_at >= date_trunc('month',now())
WHERE p.id='default'
GROUP BY p.id,p.enabled,p.monthly_allowance_usd,p.org_daily_request_limit,
  p.user_daily_request_limit,p.ip_daily_request_limit,p.concurrency_limit;

GRANT SELECT,INSERT,UPDATE,DELETE ON platform_free_ai_policy TO vantage_app;
GRANT SELECT ON sponsored_ai_usage_events,free_ai_economics TO vantage_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON platform_free_ai_policy,sponsored_ai_usage_events TO vantage_worker;
