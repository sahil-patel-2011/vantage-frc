-- Nightly team memory consolidation ("dreaming").
-- A worker cron (apps/web/app/api/cron/team-dream) folds each org's REAL
-- last-24h activity into one compact team_memories row per day so agent
-- surfaces start tomorrow knowing what happened today. Every attempt is
-- recorded in team_dream_runs. Idle days write NO memory (status 'no_activity');
-- when no AI adapter resolves, a deterministic plain-text digest of the same
-- facts is stored instead (status 'no_ai_fallback') — never invented prose.

-- team_memories was built for member-promoted chat messages, so its
-- source_thread_id / promoted_by are NOT NULL. Worker-consolidated dream rows
-- have no source thread and no promoting member — relax both and tag rows with
-- an explicit source so promoted rows stay distinguishable. Existing rows keep
-- source='promoted'; every reader selects id/content/importance and is NULL-safe.
ALTER TABLE team_memories ALTER COLUMN source_thread_id DROP NOT NULL;
ALTER TABLE team_memories ALTER COLUMN promoted_by DROP NOT NULL;
ALTER TABLE team_memories ADD COLUMN source text NOT NULL DEFAULT 'promoted'
  CHECK (source IN ('promoted', 'dream'));
CREATE INDEX team_memories_org_source_idx ON team_memories(org_id, source);

CREATE TABLE team_dream_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ran_at timestamptz NOT NULL DEFAULT now(),
  day date NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'no_activity', 'no_ai_fallback', 'error')),
  memory_id uuid REFERENCES team_memories(id) ON DELETE SET NULL,
  tokens_in integer,
  tokens_out integer,
  error_class text,
  UNIQUE (org_id, day)
);

CREATE INDEX team_dream_runs_org_day_idx ON team_dream_runs(org_id, day DESC);

ALTER TABLE team_dream_runs ENABLE ROW LEVEL SECURITY;

-- Org members may read their own org's run ledger (status/token counts only —
-- the digest content itself lives in team_memories behind its own RLS).
CREATE POLICY team_dream_runs_member_read ON team_dream_runs
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Writes are worker-only: the cron runs on the admin client (vantage_worker,
-- BYPASSRLS). The manual ?orgId= trigger goes through the same cron route, so
-- vantage_app never needs INSERT/UPDATE here.
GRANT SELECT ON team_dream_runs TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_dream_runs TO vantage_worker;
