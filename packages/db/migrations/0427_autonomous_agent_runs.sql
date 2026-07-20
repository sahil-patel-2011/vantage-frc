-- Soft-UI Autonomous Agent runs (ReAct / tool-calling loop).
-- Permanently stores: run metadata, truncated step summaries, final answer, error class.
-- Does NOT store: raw HTML forever, full prompt dumps, API keys/secrets.
-- Web fetch results keep URL + truncated text excerpt only (size-capped at write time).

CREATE TABLE autonomous_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  goal text NOT NULL CHECK (char_length(goal) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'setup_required', 'cancelled')),
  feature text NOT NULL DEFAULT 'agent',
  request_id text NOT NULL UNIQUE,
  provider text,
  model text,
  step_count integer NOT NULL DEFAULT 0 CHECK (step_count >= 0),
  max_steps integer NOT NULL DEFAULT 8 CHECK (max_steps BETWEEN 1 AND 20),
  final_answer text CHECK (final_answer IS NULL OR char_length(final_answer) <= 16000),
  error_class text,
  error_message text CHECK (error_message IS NULL OR char_length(error_message) <= 2000),
  usage_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX autonomous_agent_runs_org_started_idx
  ON autonomous_agent_runs (org_id, started_at DESC);
CREATE INDEX autonomous_agent_runs_org_user_idx
  ON autonomous_agent_runs (org_id, user_id, started_at DESC);

CREATE TABLE autonomous_agent_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES autonomous_agent_runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 0),
  kind text NOT NULL
    CHECK (kind IN ('plan', 'tool', 'observe', 'generation', 'error')),
  tool_name text,
  args_summary text CHECK (args_summary IS NULL OR char_length(args_summary) <= 2000),
  result_summary text CHECK (result_summary IS NULL OR char_length(result_summary) <= 2000),
  -- Truncated plain-text excerpt for web.fetch / search hits — never full HTML dumps.
  result_excerpt text CHECK (result_excerpt IS NULL OR char_length(result_excerpt) <= 8000),
  source_url text CHECK (source_url IS NULL OR char_length(source_url) <= 2000),
  status text NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'empty', 'setup_required', 'error')),
  request_id text,
  usage_event_id uuid REFERENCES ai_usage_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE INDEX autonomous_agent_steps_run_seq_idx
  ON autonomous_agent_steps (run_id, sequence);
CREATE INDEX autonomous_agent_steps_org_created_idx
  ON autonomous_agent_steps (org_id, created_at DESC);

ALTER TABLE autonomous_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomous_agent_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY autonomous_agent_runs_member_read ON autonomous_agent_runs
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY autonomous_agent_runs_member_insert ON autonomous_agent_runs
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY autonomous_agent_runs_owner_update ON autonomous_agent_runs
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY autonomous_agent_runs_admin_delete ON autonomous_agent_runs
  FOR DELETE TO vantage_app
  USING (
    user_id = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

CREATE POLICY autonomous_agent_steps_member_read ON autonomous_agent_steps
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY autonomous_agent_steps_member_insert ON autonomous_agent_steps
  FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND EXISTS (
      SELECT 1 FROM autonomous_agent_runs r
      WHERE r.id = run_id AND r.org_id = org_id AND r.user_id = current_app_user_id()
    )
  );

CREATE POLICY autonomous_agent_steps_admin_delete ON autonomous_agent_steps
  FOR DELETE TO vantage_app
  USING (
    EXISTS (
      SELECT 1 FROM autonomous_agent_runs r
      WHERE r.id = run_id
        AND r.org_id = org_id
        AND (
          r.user_id = current_app_user_id()
          OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
        )
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON autonomous_agent_runs, autonomous_agent_steps
  TO vantage_app, vantage_worker;
