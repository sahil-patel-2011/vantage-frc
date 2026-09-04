-- Team-6925-only deep FRC game-guess loops (Pi / Freebuff Coder UI).
-- Stores fetched sources and hourly contemplation passes. Guesses are
-- speculation labeled as such — never invented official rules.

ALTER TYPE free_relay_job_kind ADD VALUE IF NOT EXISTS 'deep_game_analysis';

CREATE TABLE deep_game_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 2100),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  min_hours integer NOT NULL DEFAULT 5 CHECK (min_hours BETWEEN 1 AND 48),
  min_loops integer NOT NULL DEFAULT 5 CHECK (min_loops BETWEEN 1 AND 48),
  loop_count integer NOT NULL DEFAULT 0 CHECK (loop_count >= 0),
  started_by uuid REFERENCES users(id),
  error text,
  latest_guess jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deep_game_analysis_runs_org_idx
  ON deep_game_analysis_runs (org_id, season_year, created_at DESC);
CREATE UNIQUE INDEX deep_game_analysis_runs_active_uq
  ON deep_game_analysis_runs (org_id, season_year)
  WHERE status IN ('queued', 'running');

CREATE TABLE deep_game_analysis_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES deep_game_analysis_runs(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text NOT NULL DEFAULT '',
  kind text NOT NULL
    CHECK (kind IN ('official', 'historical', 'teaser', 'theme', 'speculation', 'community')),
  fetch_ok boolean,
  excerpt text NOT NULL DEFAULT '',
  error text,
  fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deep_game_analysis_sources_url_chk CHECK (char_length(url) BETWEEN 12 AND 500)
);
CREATE UNIQUE INDEX deep_game_analysis_sources_run_url_uq
  ON deep_game_analysis_sources (run_id, url);
CREATE INDEX deep_game_analysis_sources_org_idx
  ON deep_game_analysis_sources (org_id, run_id);

CREATE TABLE deep_game_analysis_loops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES deep_game_analysis_runs(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 1),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  focus text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  turns jsonb NOT NULL DEFAULT '[]'::jsonb,
  guess jsonb,
  UNIQUE (run_id, sequence)
);
CREATE INDEX deep_game_analysis_loops_org_idx
  ON deep_game_analysis_loops (org_id, run_id, sequence);

ALTER TABLE deep_game_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE deep_game_analysis_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE deep_game_analysis_loops ENABLE ROW LEVEL SECURITY;

CREATE POLICY deep_game_analysis_runs_member_read ON deep_game_analysis_runs
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY deep_game_analysis_runs_admin_insert ON deep_game_analysis_runs
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY deep_game_analysis_runs_admin_update ON deep_game_analysis_runs
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY deep_game_analysis_sources_member_read ON deep_game_analysis_sources
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY deep_game_analysis_sources_admin_write ON deep_game_analysis_sources
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY deep_game_analysis_sources_admin_update ON deep_game_analysis_sources
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY deep_game_analysis_loops_member_read ON deep_game_analysis_loops
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY deep_game_analysis_loops_admin_write ON deep_game_analysis_loops
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));
CREATE POLICY deep_game_analysis_loops_admin_update ON deep_game_analysis_loops
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON
  deep_game_analysis_runs, deep_game_analysis_sources, deep_game_analysis_loops
  TO vantage_app, vantage_worker;
