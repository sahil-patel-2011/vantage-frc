-- Org BYOK routing preferences: fixed model vs Automode pool.
-- Used by /team/ai-keys Soft-UI and resolveOrgChatAdapter.

CREATE TABLE IF NOT EXISTS org_byok_routing_prefs (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'automode'
    CHECK (mode IN ('fixed', 'automode')),
  -- Stable option id from BYOK_MODEL_OPTIONS (e.g. openai:gpt-4.1-mini).
  fixed_model_id text,
  -- Enabled pool when mode = automode. Empty = all defaults for configured providers.
  enabled_model_ids text[] NOT NULL DEFAULT '{}'::text[],
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_byok_routing_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_byok_routing_member_read ON org_byok_routing_prefs;
CREATE POLICY org_byok_routing_member_read ON org_byok_routing_prefs
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

DROP POLICY IF EXISTS org_byok_routing_manage ON org_byok_routing_prefs;
CREATE POLICY org_byok_routing_manage ON org_byok_routing_prefs
  FOR ALL TO vantage_app
  USING (has_org_capability(org_id, 'manage_api_keys'::org_capability))
  WITH CHECK (has_org_capability(org_id, 'manage_api_keys'::org_capability));

GRANT SELECT, INSERT, UPDATE, DELETE ON org_byok_routing_prefs TO vantage_app, vantage_worker;
