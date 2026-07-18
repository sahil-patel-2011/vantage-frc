-- Org AI governance: feature/tool allowlists, absolute spend alerts, and
-- high-cost run approval queue. Complements org_api_budget_policies.

CREATE TABLE IF NOT EXISTS org_ai_policies (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  feature_allowlist_enabled boolean NOT NULL DEFAULT false,
  allowed_features text[] NOT NULL DEFAULT '{}',
  tool_allowlist_enabled boolean NOT NULL DEFAULT false,
  allowed_tools text[] NOT NULL DEFAULT '{}',
  high_cost_threshold_usd numeric(12,6),
  require_approval_above_threshold boolean NOT NULL DEFAULT false,
  require_approval_for_features text[] NOT NULL DEFAULT '{}',
  admin_bypass_approval boolean NOT NULL DEFAULT true,
  daily_spend_alert_usd numeric(12,6),
  monthly_spend_alert_usd numeric(12,6),
  spend_alert_thresholds integer[] NOT NULL DEFAULT '{50,75,90}',
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (high_cost_threshold_usd IS NULL OR high_cost_threshold_usd >= 0),
  CHECK (daily_spend_alert_usd IS NULL OR daily_spend_alert_usd >= 0),
  CHECK (monthly_spend_alert_usd IS NULL OR monthly_spend_alert_usd >= 0),
  CHECK (cardinality(spend_alert_thresholds) BETWEEN 1 AND 10)
);

CREATE TABLE IF NOT EXISTS ai_run_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL,
  request_id text NOT NULL,
  requester_user_id uuid NOT NULL REFERENCES users(id),
  feature text NOT NULL,
  provider text,
  model text,
  estimated_cost_usd numeric(12,6) NOT NULL,
  tools text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','denied','consumed','expired')),
  reason text,
  resolution_note text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, request_id)
);

CREATE INDEX IF NOT EXISTS ai_run_approvals_org_status_idx
  ON ai_run_approvals(org_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS org_ai_policy_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS org_ai_policy_audit_org_created_idx
  ON org_ai_policy_audit(org_id, created_at DESC);

ALTER TABLE org_ai_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_run_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_ai_policy_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_ai_policies_member_read ON org_ai_policies;
DROP POLICY IF EXISTS org_ai_policies_admin_write ON org_ai_policies;
CREATE POLICY org_ai_policies_member_read ON org_ai_policies FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY org_ai_policies_admin_write ON org_ai_policies FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_api_keys'::org_capability) OR is_platform_admin())
  WITH CHECK (
    (has_org_capability(org_id, 'manage_api_keys'::org_capability) OR is_platform_admin())
    AND updated_by = current_app_user_id()
  );

DROP POLICY IF EXISTS ai_run_approvals_member_read ON ai_run_approvals;
DROP POLICY IF EXISTS ai_run_approvals_requester_insert ON ai_run_approvals;
DROP POLICY IF EXISTS ai_run_approvals_member_update ON ai_run_approvals;
CREATE POLICY ai_run_approvals_member_read ON ai_run_approvals FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY ai_run_approvals_requester_insert ON ai_run_approvals FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND requester_user_id = current_app_user_id());
CREATE POLICY ai_run_approvals_member_update ON ai_run_approvals FOR UPDATE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      requester_user_id = current_app_user_id()
      OR has_org_capability(org_id, 'manage_api_keys'::org_capability)
      OR is_platform_admin()
    )
  )
  WITH CHECK (is_org_member(org_id));

DROP POLICY IF EXISTS org_ai_policy_audit_member_read ON org_ai_policy_audit;
DROP POLICY IF EXISTS org_ai_policy_audit_admin_insert ON org_ai_policy_audit;
CREATE POLICY org_ai_policy_audit_member_read ON org_ai_policy_audit FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY org_ai_policy_audit_admin_insert ON org_ai_policy_audit FOR INSERT TO vantage_app
  WITH CHECK (
    (has_org_capability(org_id, 'manage_api_keys'::org_capability) OR is_platform_admin())
    AND actor_user_id = current_app_user_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON org_ai_policies, ai_run_approvals, org_ai_policy_audit
  TO vantage_app, vantage_worker;
