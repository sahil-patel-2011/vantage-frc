ALTER TYPE key_source ADD VALUE IF NOT EXISTS 'local';
DO $$ BEGIN CREATE ROLE vantage_billing NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE stripe_webhook_events(event_id text PRIMARY KEY,type text NOT NULL,status text NOT NULL DEFAULT 'processing',
 error text,received_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz);
CREATE TABLE credit_packs(code text PRIMARY KEY,name text NOT NULL,credit_amount_usd numeric(12,6) NOT NULL,
 purchase_price_usd numeric(10,2) NOT NULL,stripe_price_id text,active boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE wallet_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 amount_usd numeric(12,6) NOT NULL,kind text NOT NULL,provider_cost_usd numeric(12,6) NOT NULL DEFAULT 0,
 service_markup_usd numeric(12,6) NOT NULL DEFAULT 0,stripe_event_id text UNIQUE,reference_id text,
 actor_user_id uuid REFERENCES users(id),reason text,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX wallet_ledger_org_created_idx ON wallet_ledger(org_id,created_at);
CREATE TABLE org_entitlements(org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
 plan_code text NOT NULL REFERENCES pricing_plans(code),source text NOT NULL,status text NOT NULL,
 stripe_subscription_id text,trial_ends_at timestamptz,valid_until timestamptz,updated_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE entitlement_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 plan_code text NOT NULL,action text NOT NULL,source text NOT NULL,effective_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz,actor_user_id uuid REFERENCES users(id),stripe_event_id text,metadata jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX entitlement_events_org_created_idx ON entitlement_events(org_id,created_at);
CREATE TABLE member_usage_caps(org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,spend_cap_usd numeric(12,6) NOT NULL,
 updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(org_id,user_id));
CREATE TABLE platform_connectors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,label text NOT NULL,
 endpoint text,workspace_id text,credential_ciphertext text,credential_nonce text,credential_auth_tag text,
 encrypted_dek text,kms_key_id text,model_mappings jsonb NOT NULL DEFAULT '{}',metering_mode text NOT NULL DEFAULT 'unverified',
 enabled boolean NOT NULL DEFAULT false,created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind <> 'base44' OR enabled=false OR (endpoint IS NOT NULL AND credential_ciphertext IS NOT NULL AND metering_mode='verified')));
CREATE TABLE org_provider_configs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 kind text NOT NULL,label text NOT NULL,base_url text,local_relay boolean NOT NULL DEFAULT false,
 key_ciphertext text,key_nonce text,key_auth_tag text,encrypted_dek text,kms_key_id text,
 model_mappings jsonb NOT NULL DEFAULT '{}',enabled boolean NOT NULL DEFAULT false,created_by uuid NOT NULL REFERENCES users(id),
 last_tested_at timestamptz,disabled_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX org_provider_configs_org_idx ON org_provider_configs(org_id);

ALTER TABLE credit_packs ENABLE ROW LEVEL SECURITY;ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_entitlements ENABLE ROW LEVEL SECURITY;ALTER TABLE entitlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_usage_caps ENABLE ROW LEVEL SECURITY;ALTER TABLE platform_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_provider_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_packs_read ON credit_packs FOR SELECT TO vantage_app USING(current_app_user_id() IS NOT NULL);
CREATE POLICY credit_packs_billing_read ON credit_packs FOR SELECT TO vantage_billing USING(true);
CREATE POLICY credit_packs_admin ON credit_packs FOR ALL TO vantage_app USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY wallet_member_read ON wallet_ledger FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY wallet_platform_read ON wallet_ledger FOR SELECT TO vantage_app USING(is_platform_admin());
CREATE POLICY wallet_billing_write ON wallet_ledger FOR ALL TO vantage_billing USING(true) WITH CHECK(true);
CREATE POLICY wallet_admin_gift ON wallet_ledger FOR INSERT TO vantage_app WITH CHECK(is_platform_admin() AND actor_user_id=current_app_user_id());
CREATE POLICY entitlement_member_read ON org_entitlements FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY entitlement_billing_write ON org_entitlements FOR ALL TO vantage_billing USING(true) WITH CHECK(true);
CREATE POLICY entitlement_platform ON org_entitlements FOR ALL TO vantage_app USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY entitlement_events_member_read ON entitlement_events FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY entitlement_events_billing_write ON entitlement_events FOR ALL TO vantage_billing USING(true) WITH CHECK(true);
CREATE POLICY entitlement_events_platform_insert ON entitlement_events FOR INSERT TO vantage_app WITH CHECK(is_platform_admin());
CREATE POLICY member_caps_read ON member_usage_caps FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY member_caps_admin ON member_usage_caps FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
CREATE POLICY platform_connectors_admin ON platform_connectors FOR ALL TO vantage_app USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY org_provider_member_read ON org_provider_configs FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY org_provider_admin ON org_provider_configs FOR ALL TO vantage_app
 USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
 WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND created_by=current_app_user_id());
CREATE POLICY pricing_plans_billing_read ON pricing_plans FOR SELECT TO vantage_billing USING(true);
CREATE POLICY org_billing_billing_write ON org_billing FOR ALL TO vantage_billing USING(true) WITH CHECK(true);
CREATE POLICY org_usage_policies_billing_write ON org_usage_policies FOR ALL TO vantage_billing USING(true) WITH CHECK(true);
CREATE POLICY notifications_billing_insert ON notifications FOR INSERT TO vantage_billing WITH CHECK(true);
CREATE POLICY memberships_billing_read ON memberships FOR SELECT TO vantage_billing USING(true);
CREATE POLICY users_billing_read ON users FOR SELECT TO vantage_billing USING(true);
CREATE POLICY ai_usage_platform_read ON ai_usage_events FOR SELECT TO vantage_app USING(is_platform_admin());
GRANT SELECT,INSERT,UPDATE,DELETE ON credit_packs,wallet_ledger,org_entitlements,entitlement_events,
 member_usage_caps,platform_connectors,org_provider_configs TO vantage_app,vantage_worker;

GRANT USAGE ON SCHEMA public TO vantage_billing;
GRANT SELECT,INSERT,UPDATE ON stripe_webhook_events,org_billing,org_entitlements,entitlement_events,
 wallet_ledger,notifications,credit_packs,pricing_plans,org_usage_policies TO vantage_billing;
GRANT SELECT ON memberships,users TO vantage_billing;
