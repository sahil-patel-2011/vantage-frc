-- Member capability delegation + org prompt-caching preference.
-- Capabilities let owner/admin grant elevated powers to scout/viewer without
-- promoting them to full admin. Prompt caching is an org AI cost control.

CREATE TYPE org_capability AS ENUM (
  'manage_api_keys',
  'manage_team_settings',
  'manage_members',
  'manage_billing'
);

CREATE TABLE membership_capabilities (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  capability org_capability NOT NULL,
  granted_by uuid NOT NULL REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id, capability)
);

CREATE INDEX membership_capabilities_user_idx
  ON membership_capabilities(user_id, org_id);

ALTER TABLE membership_capabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY membership_capabilities_member_read ON membership_capabilities
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id) OR is_platform_admin());

CREATE POLICY membership_capabilities_admin_write ON membership_capabilities
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR is_platform_admin())
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON membership_capabilities TO vantage_app, vantage_worker;

CREATE OR REPLACE FUNCTION has_org_capability(target_org_id uuid, needed org_capability)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships m
    WHERE m.org_id = target_org_id
      AND m.user_id = current_app_user_id()
      AND (
        m.role IN ('owner', 'admin')
        OR EXISTS (
          SELECT 1
          FROM membership_capabilities c
          WHERE c.org_id = m.org_id
            AND c.user_id = m.user_id
            AND c.capability = needed
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION has_org_capability(uuid, org_capability) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION has_org_capability(uuid, org_capability) TO vantage_app, vantage_worker;

ALTER TABLE org_api_budget_policies
  ADD COLUMN IF NOT EXISTS prompt_caching_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE ai_usage_events
  ADD COLUMN IF NOT EXISTS cache_read_input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_write_input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS uncached_input_tokens integer;

ALTER TABLE model_catalog
  ADD COLUMN IF NOT EXISTS cache_read_price_per_million_usd numeric(12,6),
  ADD COLUMN IF NOT EXISTS cache_write_price_per_million_usd numeric(12,6);

-- Expand RLS write policies so delegated capabilities enforce at the DB layer.
DROP POLICY IF EXISTS invites_admin_write ON invites;
CREATE POLICY invites_admin_write ON invites FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_members'::org_capability))
  WITH CHECK (has_org_capability(org_id, 'manage_members'::org_capability));

DROP POLICY IF EXISTS membership_audit_actor_insert ON membership_audit_events;
CREATE POLICY membership_audit_actor_insert ON membership_audit_events FOR INSERT TO vantage_app
  WITH CHECK (
    actor_user_id = current_app_user_id()
    AND (
      is_platform_admin()
      OR (
        org_id IS NOT NULL
        AND (
          has_org_role(org_id, ARRAY['owner','admin']::org_role[])
          OR has_org_capability(org_id, 'manage_members'::org_capability)
        )
      )
    )
  );

DROP POLICY IF EXISTS org_provider_admin ON org_provider_configs;
CREATE POLICY org_provider_admin ON org_provider_configs FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_api_keys'::org_capability))
  WITH CHECK (
    has_org_capability(org_id, 'manage_api_keys'::org_capability)
    AND created_by = current_app_user_id()
  );

DROP POLICY IF EXISTS keys_admin ON org_llm_keys;
CREATE POLICY keys_admin ON org_llm_keys FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_api_keys'::org_capability))
  WITH CHECK (has_org_capability(org_id, 'manage_api_keys'::org_capability));

DROP POLICY IF EXISTS org_auth_policy_admin_write ON org_auth_policies;
CREATE POLICY org_auth_policy_admin_write ON org_auth_policies FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_team_settings'::org_capability))
  WITH CHECK (
    has_org_capability(org_id, 'manage_team_settings'::org_capability)
    AND updated_by = current_app_user_id()
  );

DROP POLICY IF EXISTS context_admin_write ON org_active_context;
CREATE POLICY context_admin_write ON org_active_context FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_team_settings'::org_capability))
  WITH CHECK (has_org_capability(org_id, 'manage_team_settings'::org_capability));

DROP POLICY IF EXISTS org_budget_admin_write ON org_api_budget_policies;
CREATE POLICY org_budget_admin_write ON org_api_budget_policies FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_api_keys'::org_capability))
  WITH CHECK (
    has_org_capability(org_id, 'manage_api_keys'::org_capability)
    AND updated_by = current_app_user_id()
  );

DROP POLICY IF EXISTS member_budget_admin_write ON org_api_member_limits;
CREATE POLICY member_budget_admin_write ON org_api_member_limits FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_api_keys'::org_capability))
  WITH CHECK (
    has_org_capability(org_id, 'manage_api_keys'::org_capability)
    AND updated_by = current_app_user_id()
  );

DROP POLICY IF EXISTS feature_budget_admin_write ON org_api_feature_limits;
CREATE POLICY feature_budget_admin_write ON org_api_feature_limits FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_api_keys'::org_capability))
  WITH CHECK (
    has_org_capability(org_id, 'manage_api_keys'::org_capability)
    AND updated_by = current_app_user_id()
  );

DROP POLICY IF EXISTS model_budget_admin_write ON org_api_model_limits;
CREATE POLICY model_budget_admin_write ON org_api_model_limits FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_api_keys'::org_capability))
  WITH CHECK (
    has_org_capability(org_id, 'manage_api_keys'::org_capability)
    AND updated_by = current_app_user_id()
  );

DROP POLICY IF EXISTS budget_audit_admin_insert ON budget_policy_audit;
CREATE POLICY budget_audit_admin_insert ON budget_policy_audit FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_capability(org_id, 'manage_api_keys'::org_capability)
    AND actor_user_id = current_app_user_id()
  );

DROP POLICY IF EXISTS billing_admin_write ON org_billing;
CREATE POLICY billing_admin_write ON org_billing FOR UPDATE TO vantage_app
  USING (has_org_capability(org_id, 'manage_billing'::org_capability))
  WITH CHECK (has_org_capability(org_id, 'manage_billing'::org_capability));
