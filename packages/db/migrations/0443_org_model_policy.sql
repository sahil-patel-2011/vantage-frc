-- Org model SELECTION policy: which AI models members may pick, app-wide.
-- Distinct from billing's org_api_model_limits / model_allowlist_enabled (SPEND limits).
-- Modes:
--   allow_all  (default) — every catalog model is selectable.
--   allowlist            — only allowed_model_ids are selectable; other picks fall back.
--   force_auto           — members cannot pick; automode routing decides.

CREATE TABLE IF NOT EXISTS org_model_policy (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'allow_all'
    CHECK (mode IN ('allow_all','allowlist','force_auto')),
  allowed_model_ids text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_model_policy ENABLE ROW LEVEL SECURITY;

-- Every member may read the policy — they need to know what they may pick.
DROP POLICY IF EXISTS org_model_policy_member_read ON org_model_policy;
CREATE POLICY org_model_policy_member_read ON org_model_policy
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Only owners/admins may set or change the policy.
DROP POLICY IF EXISTS org_model_policy_admin_insert ON org_model_policy;
CREATE POLICY org_model_policy_admin_insert ON org_model_policy
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

DROP POLICY IF EXISTS org_model_policy_admin_update ON org_model_policy;
CREATE POLICY org_model_policy_admin_update ON org_model_policy
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE ON org_model_policy TO vantage_app, vantage_worker;
