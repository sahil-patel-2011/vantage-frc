-- AI render attempts: one row per "AI-led" feature render, saying honestly whether a real
-- model produced the output (mode='model') or the deterministic template stood in
-- (mode='template', with the reason). Governance (/team/ai-policy) reads this per feature
-- so "AI-led" is a measured claim, never a label. Written by renderWithModel in
-- packages/agent/src/render.ts on every call — success or fallback.

CREATE TABLE ai_render_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature text NOT NULL CHECK (char_length(feature) BETWEEN 1 AND 80),
  mode text NOT NULL CHECK (mode IN ('model', 'template')),
  model_id text,
  provider text,
  -- Why the template stood in: no_provider, cap_hit, timeout, provider_error,
  -- empty_output, rejected_output, … NULL when mode='model'.
  fallback_reason text CHECK (fallback_reason IS NULL OR char_length(fallback_reason) <= 120),
  prompt_tokens integer NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens integer NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  cost_usd numeric(10,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_render_attempts_org_created_idx ON ai_render_attempts (org_id, created_at DESC);
CREATE INDEX ai_render_attempts_org_feature_idx ON ai_render_attempts (org_id, feature);

ALTER TABLE ai_render_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_render_attempts_member_read ON ai_render_attempts
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY ai_render_attempts_member_insert ON ai_render_attempts
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

GRANT SELECT, INSERT ON ai_render_attempts TO vantage_app, vantage_worker;

-- Autonomous agent runs now execute after the POST returns (next/server `after`), so a
-- run needs a cooperative cancel flag the loop checks between steps. The owner-update
-- policy from 0427 already lets the run's owner set it.
ALTER TABLE autonomous_agent_runs ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
