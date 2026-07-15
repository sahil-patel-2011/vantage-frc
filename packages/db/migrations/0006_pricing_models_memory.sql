CREATE TABLE pricing_plans (
  code text PRIMARY KEY,name text NOT NULL,monthly_price_usd numeric(10,2) NOT NULL,
  included_allowance_usd numeric(12,6) NOT NULL DEFAULT 0,features jsonb NOT NULL DEFAULT '[]',
  stripe_price_id text,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pricing_plans(code,name,monthly_price_usd,features) VALUES
 ('free','Free',0,'["BYOK","usage visibility"]'),
 ('managed_20','Vantage Pro',20,'["managed model routing","unified context"]'),
 ('managed_50','Vantage Max',50,'["higher configurable allowance","expanded features"]');
CREATE TABLE org_usage_policies (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  payg_enabled boolean NOT NULL DEFAULT false,prepaid_balance_usd numeric(12,6) NOT NULL DEFAULT 0,
  overage_spend_cap_usd numeric(12,6) NOT NULL DEFAULT 0,
  low_balance_warning_usd numeric(12,6) NOT NULL DEFAULT 0,kill_switch boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_provider_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider text NOT NULL,label text NOT NULL,
  key_ciphertext text NOT NULL,key_nonce text NOT NULL,key_auth_tag text NOT NULL,
  encrypted_dek text NOT NULL,kms_key_id text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
  last_used_at timestamptz,disabled_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_provider_keys_provider_idx ON platform_provider_keys(provider);
CREATE TABLE model_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),display_name text UNIQUE NOT NULL,provider text NOT NULL,
  provider_model_id text,input_price_per_million_usd numeric(12,6) NOT NULL DEFAULT 0,
  output_price_per_million_usd numeric(12,6) NOT NULL DEFAULT 0,context_window_tokens integer,
  capabilities text[] NOT NULL DEFAULT '{}',eligible_plans text[] NOT NULL DEFAULT '{}',
  payg_only boolean NOT NULL DEFAULT false,enabled boolean NOT NULL DEFAULT false,
  routing_weight double precision NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO model_catalog(display_name,provider,payg_only) VALUES
 ('GPT 5.6 Sol','openai',false),('GPT 5.6 Terra','openai',false),
 ('Claude Opus 4.8','anthropic',false),('Claude Sonnet 5','anthropic',false),
 ('Fable 5','fable',true);

CREATE TABLE agent_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),scope text NOT NULL CHECK(scope IN ('private','team')),
  title text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((scope='private') OR (scope='team' AND org_id IS NOT NULL))
);
CREATE INDEX agent_threads_user_updated_idx ON agent_threads(created_by,updated_at);
CREATE TABLE agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),thread_id uuid NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id),role text NOT NULL CHECK(role IN ('user','assistant','system')),
  content text NOT NULL,explicitly_shared boolean NOT NULL DEFAULT false,provider text,model text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_messages_thread_created_idx ON agent_messages(thread_id,created_at);
CREATE TABLE user_memory_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,enabled boolean NOT NULL DEFAULT true,
  token_budget integer NOT NULL DEFAULT 1200 CHECK(token_budget BETWEEN 0 AND 10000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,content text NOT NULL,source_thread_id uuid REFERENCES agent_threads(id) ON DELETE SET NULL,
  source_message_id uuid REFERENCES agent_messages(id) ON DELETE SET NULL,importance double precision NOT NULL DEFAULT .5,
  disabled_at timestamptz,expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_memories_user_updated_idx ON user_memories(user_id,updated_at);
CREATE TABLE team_memory_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,enabled boolean NOT NULL DEFAULT false,
  token_budget integer NOT NULL DEFAULT 1600 CHECK(token_budget BETWEEN 0 AND 10000),
  retention_days integer NOT NULL DEFAULT 365 CHECK(retention_days BETWEEN 1 AND 3650),
  updated_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE team_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  content text NOT NULL,source_thread_id uuid NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  source_message_id uuid REFERENCES agent_messages(id) ON DELETE SET NULL,promoted_by uuid NOT NULL REFERENCES users(id),
  importance double precision NOT NULL DEFAULT .5,disabled_at timestamptz,expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_memories_org_updated_idx ON team_memories(org_id,updated_at);
CREATE TABLE agent_context_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),thread_id uuid NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  message_id uuid REFERENCES agent_messages(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id),
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,source_refs jsonb NOT NULL,token_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pricing_plans ENABLE ROW LEVEL SECURITY;ALTER TABLE org_usage_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_provider_keys ENABLE ROW LEVEL SECURITY;ALTER TABLE model_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_threads ENABLE ROW LEVEL SECURITY;ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_memory_settings ENABLE ROW LEVEL SECURITY;ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_memory_settings ENABLE ROW LEVEL SECURITY;ALTER TABLE team_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_context_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_read ON pricing_plans FOR SELECT TO vantage_app USING(current_app_user_id() IS NOT NULL);
CREATE POLICY plans_admin ON pricing_plans FOR ALL TO vantage_app USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY usage_policy_member_read ON org_usage_policies FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY usage_policy_admin_write ON org_usage_policies FOR ALL TO vantage_app
  USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
  WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
CREATE POLICY provider_keys_admin ON platform_provider_keys FOR ALL TO vantage_app
  USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY models_read ON model_catalog FOR SELECT TO vantage_app USING(current_app_user_id() IS NOT NULL);
CREATE POLICY models_admin ON model_catalog FOR ALL TO vantage_app USING(is_platform_admin()) WITH CHECK(is_platform_admin());
CREATE POLICY threads_read ON agent_threads FOR SELECT TO vantage_app
  USING((scope='private' AND created_by=current_app_user_id()) OR (scope='team' AND is_org_member(org_id)));
CREATE POLICY threads_insert ON agent_threads FOR INSERT TO vantage_app
  WITH CHECK(created_by=current_app_user_id() AND ((scope='private' AND org_id IS NULL) OR (scope='team' AND is_org_member(org_id))));
CREATE POLICY threads_owner_update ON agent_threads FOR UPDATE TO vantage_app
  USING(created_by=current_app_user_id()) WITH CHECK(created_by=current_app_user_id());
CREATE POLICY messages_read ON agent_messages FOR SELECT TO vantage_app USING(EXISTS(
  SELECT 1 FROM agent_threads t WHERE t.id=thread_id AND
  ((t.scope='private' AND t.created_by=current_app_user_id()) OR (t.scope='team' AND is_org_member(t.org_id)))
));
CREATE POLICY messages_insert ON agent_messages FOR INSERT TO vantage_app WITH CHECK(EXISTS(
  SELECT 1 FROM agent_threads t WHERE t.id=thread_id AND
  ((t.scope='private' AND t.created_by=current_app_user_id() AND author_user_id=current_app_user_id() AND NOT explicitly_shared)
   OR (t.scope='team' AND is_org_member(t.org_id) AND (author_user_id=current_app_user_id() OR author_user_id IS NULL) AND explicitly_shared))
));
CREATE POLICY messages_author_update ON agent_messages FOR UPDATE TO vantage_app
  USING(author_user_id=current_app_user_id()) WITH CHECK(author_user_id=current_app_user_id());
CREATE POLICY user_memory_self ON user_memories FOR ALL TO vantage_app
  USING(user_id=current_app_user_id()) WITH CHECK(user_id=current_app_user_id());
CREATE POLICY user_memory_settings_self ON user_memory_settings FOR ALL TO vantage_app
  USING(user_id=current_app_user_id()) WITH CHECK(user_id=current_app_user_id());
CREATE POLICY team_memory_member_read ON team_memories FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY team_memory_opted_insert ON team_memories FOR INSERT TO vantage_app WITH CHECK(
  is_org_member(org_id) AND promoted_by=current_app_user_id() AND EXISTS(
    SELECT 1 FROM agent_threads t LEFT JOIN agent_messages m ON m.id=source_message_id
    WHERE t.id=source_thread_id AND (
      (t.scope='team' AND t.org_id=org_id) OR
      (m.explicitly_shared AND m.author_user_id=current_app_user_id())
    )
  )
);
CREATE POLICY team_memory_admin_update ON team_memories FOR UPDATE TO vantage_app
  USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
CREATE POLICY team_memory_settings_member_read ON team_memory_settings FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY team_memory_settings_admin ON team_memory_settings FOR ALL TO vantage_app
  USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]))
  WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
CREATE POLICY context_usage_read ON agent_context_usage FOR SELECT TO vantage_app
  USING(user_id=current_app_user_id() OR (org_id IS NOT NULL AND is_org_member(org_id)));
CREATE POLICY context_usage_insert ON agent_context_usage FOR INSERT TO vantage_app
  WITH CHECK(user_id=current_app_user_id());
GRANT SELECT,INSERT,UPDATE,DELETE ON pricing_plans,org_usage_policies,platform_provider_keys,
 model_catalog,agent_threads,agent_messages,user_memory_settings,user_memories,team_memory_settings,
 team_memories,agent_context_usage TO vantage_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON pricing_plans,org_usage_policies,platform_provider_keys,
 model_catalog,agent_threads,agent_messages,user_memory_settings,user_memories,team_memory_settings,
 team_memories,agent_context_usage TO vantage_worker;
