-- Kickoff game-release intelligence.
-- Stores per-org / per-season structured summaries derived from the game manual
-- and kickoff transcript, with provenance (ai_run, provider/model, source checksums).
-- Downstream hooks seed design priorities and CAD engineering briefs from these rows.

CREATE TABLE IF NOT EXISTS kickoff_game_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 2100),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('empty', 'ready', 'applied', 'setup_required')),
  title text NOT NULL DEFAULT 'Game release summary',
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  strategy_advice jsonb NOT NULL DEFAULT '{}'::jsonb,
  design_priorities_draft jsonb NOT NULL DEFAULT '[]'::jsonb,
  cad_brief_request text NOT NULL DEFAULT '',
  cad_job_id uuid,
  ai_run_id uuid,
  ai_artifact_id uuid,
  provider text NOT NULL DEFAULT 'local',
  model text NOT NULL DEFAULT 'vantage-kickoff-intelligence-v1',
  source_manual_excerpt text NOT NULL DEFAULT '',
  source_transcript_excerpt text NOT NULL DEFAULT '',
  source_url text,
  source_checksum text NOT NULL DEFAULT '',
  advice_label text NOT NULL DEFAULT 'MODEL' CHECK (advice_label IN ('MODEL')),
  applied_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kickoff_game_intelligence_org_idx
  ON kickoff_game_intelligence(org_id, season_year, created_at DESC);

ALTER TABLE kickoff_game_intelligence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kickoff_game_intelligence_read ON kickoff_game_intelligence;
DROP POLICY IF EXISTS kickoff_game_intelligence_insert ON kickoff_game_intelligence;
DROP POLICY IF EXISTS kickoff_game_intelligence_update ON kickoff_game_intelligence;
DROP POLICY IF EXISTS kickoff_game_intelligence_delete ON kickoff_game_intelligence;

CREATE POLICY kickoff_game_intelligence_read ON kickoff_game_intelligence
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY kickoff_game_intelligence_insert ON kickoff_game_intelligence
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY kickoff_game_intelligence_update ON kickoff_game_intelligence
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY kickoff_game_intelligence_delete ON kickoff_game_intelligence
  FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON kickoff_game_intelligence TO vantage_app, vantage_worker;
