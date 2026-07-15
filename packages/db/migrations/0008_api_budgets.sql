CREATE TABLE platform_api_safety_caps (
  tier billing_tier PRIMARY KEY,max_daily_spend_usd numeric(12,6),max_monthly_spend_usd numeric(12,6),
  max_daily_tokens integer,max_monthly_tokens integer,updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE org_api_budget_policies (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  daily_spend_limit_usd numeric(12,6),monthly_spend_limit_usd numeric(12,6),
  daily_token_limit integer,monthly_token_limit integer,warning_thresholds integer[] NOT NULL DEFAULT '{50,75,90}',
  enforce_byo_token_limits boolean NOT NULL DEFAULT true,model_allowlist_enabled boolean NOT NULL DEFAULT false,
  provider_allowlist_enabled boolean NOT NULL DEFAULT false,kill_switch boolean NOT NULL DEFAULT false,
  updated_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(daily_spend_limit_usd IS NULL OR daily_spend_limit_usd>=0),
  CHECK(monthly_spend_limit_usd IS NULL OR monthly_spend_limit_usd>=0),
  CHECK(daily_token_limit IS NULL OR daily_token_limit>=0),CHECK(monthly_token_limit IS NULL OR monthly_token_limit>=0),
  CHECK(cardinality(warning_thresholds) BETWEEN 1 AND 10)
);
CREATE TABLE org_api_member_limits (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  daily_spend_limit_usd numeric(12,6),monthly_spend_limit_usd numeric(12,6),daily_token_limit integer,
  monthly_token_limit integer,updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,user_id)
);
CREATE TABLE org_api_feature_limits (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,feature text NOT NULL,
  daily_spend_limit_usd numeric(12,6),monthly_spend_limit_usd numeric(12,6),daily_token_limit integer,
  monthly_token_limit integer,updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,feature)
);
CREATE TABLE org_api_model_limits (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,provider text NOT NULL,model text NOT NULL,
  allowed boolean NOT NULL DEFAULT true,daily_spend_limit_usd numeric(12,6),monthly_spend_limit_usd numeric(12,6),
  daily_token_limit integer,monthly_token_limit integer,updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(org_id,provider,model)
);
CREATE TABLE api_usage_denials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),feature text NOT NULL,provider text,model text,
  estimated_cost_usd numeric(12,6) NOT NULL,estimated_tokens integer NOT NULL,reason text NOT NULL,
  request_id text UNIQUE NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_usage_denials_org_created_idx ON api_usage_denials(org_id,created_at);
CREATE TABLE budget_policy_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),action text NOT NULL,before jsonb,after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX budget_policy_audit_org_created_idx ON budget_policy_audit(org_id,created_at);

CREATE OR REPLACE FUNCTION enforce_platform_api_cap() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cap platform_api_safety_caps%ROWTYPE; org_tier billing_tier;
BEGIN
  SELECT tier INTO org_tier FROM org_billing WHERE org_id=NEW.org_id;
  SELECT * INTO cap FROM platform_api_safety_caps WHERE tier=org_tier;
  IF cap.tier IS NULL THEN RETURN NEW; END IF;
  IF cap.max_daily_spend_usd IS NOT NULL AND NEW.daily_spend_limit_usd IS NOT NULL AND NEW.daily_spend_limit_usd>cap.max_daily_spend_usd THEN RAISE EXCEPTION 'Daily spend limit exceeds platform safety cap'; END IF;
  IF cap.max_monthly_spend_usd IS NOT NULL AND NEW.monthly_spend_limit_usd IS NOT NULL AND NEW.monthly_spend_limit_usd>cap.max_monthly_spend_usd THEN RAISE EXCEPTION 'Monthly spend limit exceeds platform safety cap'; END IF;
  IF cap.max_daily_tokens IS NOT NULL AND NEW.daily_token_limit IS NOT NULL AND NEW.daily_token_limit>cap.max_daily_tokens THEN RAISE EXCEPTION 'Daily token limit exceeds platform safety cap'; END IF;
  IF cap.max_monthly_tokens IS NOT NULL AND NEW.monthly_token_limit IS NOT NULL AND NEW.monthly_token_limit>cap.max_monthly_tokens THEN RAISE EXCEPTION 'Monthly token limit exceeds platform safety cap'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER org_budget_platform_cap BEFORE INSERT OR UPDATE ON org_api_budget_policies
 FOR EACH ROW EXECUTE FUNCTION enforce_platform_api_cap();
CREATE TRIGGER member_budget_platform_cap BEFORE INSERT OR UPDATE ON org_api_member_limits
 FOR EACH ROW EXECUTE FUNCTION enforce_platform_api_cap();
CREATE TRIGGER feature_budget_platform_cap BEFORE INSERT OR UPDATE ON org_api_feature_limits
 FOR EACH ROW EXECUTE FUNCTION enforce_platform_api_cap();
CREATE TRIGGER model_budget_platform_cap BEFORE INSERT OR UPDATE ON org_api_model_limits
 FOR EACH ROW EXECUTE FUNCTION enforce_platform_api_cap();

ALTER TABLE platform_api_safety_caps ENABLE ROW LEVEL SECURITY;ALTER TABLE org_api_budget_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_api_member_limits ENABLE ROW LEVEL SECURITY;ALTER TABLE org_api_feature_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_api_model_limits ENABLE ROW LEVEL SECURITY;ALTER TABLE api_usage_denials ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_policy_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY safety_caps_authenticated_read ON platform_api_safety_caps FOR SELECT TO vantage_app USING(current_app_user_id() IS NOT NULL);
CREATE POLICY safety_caps_platform_write ON platform_api_safety_caps FOR ALL TO vantage_app USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY org_budget_member_read ON org_api_budget_policies FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY org_budget_admin_write ON org_api_budget_policies FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND updated_by=current_app_user_id());
CREATE POLICY member_budget_member_read ON org_api_member_limits FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY member_budget_admin_write ON org_api_member_limits FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND updated_by=current_app_user_id());
CREATE POLICY feature_budget_member_read ON org_api_feature_limits FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY feature_budget_admin_write ON org_api_feature_limits FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND updated_by=current_app_user_id());
CREATE POLICY model_budget_member_read ON org_api_model_limits FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY model_budget_admin_write ON org_api_model_limits FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND updated_by=current_app_user_id());
CREATE POLICY denials_member_read ON api_usage_denials FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY denials_self_insert ON api_usage_denials FOR INSERT TO vantage_app
 WITH CHECK(is_org_member(org_id) AND user_id=current_app_user_id());
CREATE POLICY budget_audit_member_read ON budget_policy_audit FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY budget_audit_admin_insert ON budget_policy_audit FOR INSERT TO vantage_app
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND actor_user_id=current_app_user_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON platform_api_safety_caps,org_api_budget_policies,org_api_member_limits,
 org_api_feature_limits,org_api_model_limits,api_usage_denials,budget_policy_audit TO vantage_app,vantage_worker;
