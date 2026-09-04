-- Continuous 5-hour deep analysis (no hourly schedule) plus DeepSeek V4 Flash
-- as an explicit picker choice. DeepSeek stays labeled metered — this is not
-- a claim that it is free forever.

ALTER TABLE deep_game_analysis_runs
  ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT 'glm/glm-5.3-flash';

ALTER TABLE deep_game_analysis_runs
  DROP CONSTRAINT IF EXISTS deep_game_analysis_runs_model_chk;

ALTER TABLE deep_game_analysis_runs
  ADD CONSTRAINT deep_game_analysis_runs_model_chk
  CHECK (
    model IN (
      'glm/glm-5.3-flash',
      'mimo/mimo-2.5',
      'deepseek/deepseek-v4-flash'
    )
  );

ALTER TABLE deep_game_analysis_runs
  ALTER COLUMN min_loops SET DEFAULT 1;

ALTER TABLE org_byok_routing_prefs
  DROP CONSTRAINT IF EXISTS org_byok_routing_prefs_freebuff_model_chk;

ALTER TABLE org_byok_routing_prefs
  ADD CONSTRAINT org_byok_routing_prefs_freebuff_model_chk
  CHECK (
    freebuff_model IS NULL
    OR freebuff_model IN (
      'glm/glm-5.3-flash',
      'mimo/mimo-2.5',
      'deepseek/deepseek-v4-flash'
    )
  );

COMMENT ON COLUMN deep_game_analysis_runs.model IS
  'Freebuff slug for this continuous 5-hour run. DeepSeek V4 Flash is metered.';

COMMENT ON COLUMN org_byok_routing_prefs.freebuff_model IS
  'Team-picked Freebuff slug. GLM and MiMo are unmetered; DeepSeek V4 Flash is metered.';
