ALTER TABLE plan_entitlement_versions ADD COLUMN billing_owner_type text NOT NULL DEFAULT 'org' CHECK(billing_owner_type IN ('user','org'));
ALTER TABLE plan_entitlement_versions ADD COLUMN included_credits numeric(12,6) NOT NULL DEFAULT 0;
ALTER TABLE plan_entitlement_versions ADD COLUMN service_multiplier numeric(8,4) NOT NULL DEFAULT 1.25 CHECK(service_multiplier>=1);
ALTER TABLE plan_entitlement_versions ADD COLUMN fair_use jsonb NOT NULL DEFAULT '{}';
ALTER TABLE platform_margin_config ADD COLUMN support_reserve_percent numeric(6,2) NOT NULL DEFAULT 5;
ALTER TABLE platform_margin_config ADD COLUMN service_multiplier numeric(8,4) NOT NULL DEFAULT 1.25;
UPDATE pricing_plans SET active=false WHERE code IN ('managed_20','managed_50');
INSERT INTO pricing_plans(code,name,monthly_price_usd,included_allowance_usd,features,active) VALUES
('individual_pro','Individual Pro',30,0,'["private workspace and personal AI jobs","15 included Vantage Credits","larger personal context and CAD/code limits"]',true),
('individual_max','Individual Max',50,0,'["private workspace and personal AI jobs","30 included Vantage Credits","higher personal context, agent, CAD, and code limits"]',true),
('team_pro','Team Pro',100,0,'["entire organization","60 pooled Vantage Credits","premium shared AI and team automations"]',true),
('team_max','Team Max',200,0,'["entire organization","130 pooled Vantage Credits","highest team context, priority, concurrency, CAD, strategy, and code limits"]',true)
ON CONFLICT(code) DO UPDATE SET name=excluded.name,monthly_price_usd=excluded.monthly_price_usd,features=excluded.features,active=true;
INSERT INTO plan_entitlement_versions(plan_code,version,effective_at,managed_allowance_usd,billing_owner_type,included_credits,service_multiplier,fair_use,context_token_limit,agent_step_limit,cad_iteration_limit,cad_concurrent_jobs,code_analysis_mb,job_priority,feature_flags,change_notice) VALUES
('individual_pro',1,'2026-07-15',0,'user',15,1.25,'{"maxConcurrentPrivateJobs":2}',16000,24,20,2,50,10,'{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true}', 'Launch recommendation; applies only to new periods and may change with notice.'),
('individual_max',1,'2026-07-15',0,'user',30,1.25,'{"maxConcurrentPrivateJobs":4}',48000,60,60,4,200,18,'{"private_managed_ai":true,"team_automations":false,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true}', 'Launch recommendation; applies only to new periods and may change with notice.'),
('team_pro',1,'2026-07-15',0,'org',60,1.25,'{"maxConcurrentTeamJobs":5}',64000,100,100,5,500,25,'{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true}', 'Launch recommendation; organization-wide terms snapshot at renewal.'),
('team_max',1,'2026-07-15',0,'org',130,1.25,'{"maxConcurrentTeamJobs":12}',160000,250,300,12,2000,40,'{"private_managed_ai":true,"team_automations":true,"shared_memory":true,"advanced_strategy":true,"cad_design_review":true,"scenario_sweeps":true,"advanced_team_admin":true}', 'Launch recommendation; organization-wide terms snapshot at renewal.')
ON CONFLICT(plan_code,version) DO NOTHING;
CREATE OR REPLACE FUNCTION validate_plan_margin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE price numeric;fees numeric;infra numeric;reserve numeric;worst_provider numeric;
BEGIN SELECT monthly_price_usd INTO price FROM pricing_plans WHERE code=NEW.plan_code;
 SELECT price*stripe_fee_percent/100+stripe_fixed_fee_usd,infrastructure_allocation_usd,price*support_reserve_percent/100
 INTO fees,infra,reserve FROM platform_margin_config WHERE id='default';
 worst_provider:=NEW.included_credits/NEW.service_multiplier;
 IF price>0 AND worst_provider+fees+infra+reserve>price AND COALESCE((NEW.fair_use->>'confirmStructuralLoss')::boolean,false)=false
 THEN RAISE EXCEPTION 'Plan configuration is structurally loss-making; explicit confirmation is required';END IF;RETURN NEW;END $$;
CREATE TRIGGER plan_margin_guard BEFORE INSERT OR UPDATE ON plan_entitlement_versions FOR EACH ROW EXECUTE FUNCTION validate_plan_margin();

CREATE TABLE billing_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_type text NOT NULL CHECK(owner_type IN ('user','org')),
 owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,owner_org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
 stripe_customer_id text UNIQUE,status text NOT NULL DEFAULT 'active',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((owner_type='user' AND owner_user_id IS NOT NULL AND owner_org_id IS NULL) OR (owner_type='org' AND owner_org_id IS NOT NULL AND owner_user_id IS NULL))
);
CREATE UNIQUE INDEX billing_accounts_user_uq ON billing_accounts(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX billing_accounts_org_uq ON billing_accounts(owner_org_id) WHERE owner_org_id IS NOT NULL;
CREATE TABLE billing_subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),billing_account_id uuid NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
 plan_code text NOT NULL REFERENCES pricing_plans(code),entitlement_version_id uuid NOT NULL REFERENCES plan_entitlement_versions(id),
 stripe_subscription_id text UNIQUE,stripe_price_id text,status text NOT NULL,current_period_start timestamptz NOT NULL,current_period_end timestamptz NOT NULL,
 cancel_at_period_end boolean NOT NULL DEFAULT false,terms_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_wallets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),billing_account_id uuid UNIQUE NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
 included_balance numeric(12,6) NOT NULL DEFAULT 0,purchased_balance numeric(12,6) NOT NULL DEFAULT 0,gifted_balance numeric(12,6) NOT NULL DEFAULT 0,
 payg_enabled boolean NOT NULL DEFAULT false,payg_monthly_cap_usd numeric(12,2) NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE credit_ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),billing_account_id uuid NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
 kind text NOT NULL,credits numeric(12,6) NOT NULL,provider_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
 service_multiplier numeric(8,4) NOT NULL DEFAULT 1.25,bucket text NOT NULL,reference_id text,metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_account_created_idx ON credit_ledger(billing_account_id,created_at);
CREATE TABLE org_member_funding_policies (
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 allow_individual_funding boolean NOT NULL DEFAULT false,enabled_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(org_id,user_id)
);
CREATE TABLE trial_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),billing_account_id uuid UNIQUE NOT NULL REFERENCES billing_accounts(id) ON DELETE CASCADE,
 plan_code text NOT NULL REFERENCES pricing_plans(code),credits_cap numeric(12,6) NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 consumed_at timestamptz,auto_charge_consent boolean NOT NULL DEFAULT false,granted_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(ends_at<=starts_at+interval '7 days')
);
ALTER TABLE ai_runs ADD COLUMN billing_owner_type text CHECK(billing_owner_type IN ('user','org'));
ALTER TABLE ai_runs ADD COLUMN billing_owner_id uuid;
ALTER TABLE ai_runs ADD COLUMN entitlement_snapshot jsonb;
ALTER TABLE ai_runs ADD COLUMN allowance_bucket text;
ALTER TABLE ai_runs ADD COLUMN provider_cost_usd numeric(12,6);
ALTER TABLE ai_runs ADD COLUMN credit_debit numeric(12,6);
ALTER TABLE ai_runs ADD COLUMN routing_decision jsonb;
ALTER TABLE billing_accounts ENABLE ROW LEVEL SECURITY;ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_wallets ENABLE ROW LEVEL SECURITY;ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_member_funding_policies ENABLE ROW LEVEL SECURITY;ALTER TABLE trial_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_accounts_owner ON billing_accounts FOR SELECT TO vantage_app USING(owner_user_id=current_app_user_id() OR (owner_org_id IS NOT NULL AND has_org_role(owner_org_id,ARRAY['owner','admin']::org_role[])) OR is_platform_admin());
CREATE POLICY subscriptions_owner ON billing_subscriptions FOR SELECT TO vantage_app USING(EXISTS(SELECT 1 FROM billing_accounts a WHERE a.id=billing_account_id AND (a.owner_user_id=current_app_user_id() OR (a.owner_org_id IS NOT NULL AND has_org_role(a.owner_org_id,ARRAY['owner','admin']::org_role[])) OR is_platform_admin())));
CREATE POLICY wallets_owner ON credit_wallets FOR SELECT TO vantage_app USING(EXISTS(SELECT 1 FROM billing_accounts a WHERE a.id=billing_account_id AND (a.owner_user_id=current_app_user_id() OR (a.owner_org_id IS NOT NULL AND has_org_role(a.owner_org_id,ARRAY['owner','admin']::org_role[])) OR is_platform_admin())));
CREATE POLICY credit_ledger_owner ON credit_ledger FOR SELECT TO vantage_app USING(EXISTS(SELECT 1 FROM billing_accounts a WHERE a.id=billing_account_id AND (a.owner_user_id=current_app_user_id() OR (a.owner_org_id IS NOT NULL AND has_org_role(a.owner_org_id,ARRAY['owner','admin']::org_role[])) OR is_platform_admin())));
CREATE POLICY member_funding_member_read ON org_member_funding_policies FOR SELECT TO vantage_app USING(user_id=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
CREATE POLICY member_funding_admin ON org_member_funding_policies FOR ALL TO vantage_app USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[])) WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND enabled_by=current_app_user_id());
CREATE POLICY trials_owner ON trial_grants FOR SELECT TO vantage_app USING(EXISTS(SELECT 1 FROM billing_accounts a WHERE a.id=billing_account_id AND (a.owner_user_id=current_app_user_id() OR (a.owner_org_id IS NOT NULL AND has_org_role(a.owner_org_id,ARRAY['owner','admin']::org_role[])) OR is_platform_admin())));
GRANT SELECT ON billing_accounts,billing_subscriptions,credit_wallets,credit_ledger,trial_grants TO vantage_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON org_member_funding_policies TO vantage_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON billing_accounts,billing_subscriptions,credit_wallets,credit_ledger,trial_grants TO vantage_billing;
