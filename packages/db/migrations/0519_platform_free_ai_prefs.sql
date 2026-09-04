-- Per-team "use platform Free AI" toggle and the two unmetered FreeBuff models.
--
-- One Pi / one FreeBuff session serves every org on this deployment. Isolation is
-- not a property of that box — it is a property of what Vantage sends. These
-- columns only record the team's routing choice; they never store another team's
-- context. Default ON so a grant actually takes effect without a second click.
--
-- freebuff_model is allowlisted to the two models Codebuff lists as unmetered
-- (GLM 5.3 Flash, MiMo 2.5). DeepSeek V4 Flash and anything else is refused here
-- so a picker cannot offer a "free forever" slug that then pauses mid-match.

ALTER TABLE org_byok_routing_prefs
  ADD COLUMN IF NOT EXISTS use_platform_free_ai boolean NOT NULL DEFAULT true;

ALTER TABLE org_byok_routing_prefs
  ADD COLUMN IF NOT EXISTS freebuff_model text;

ALTER TABLE org_byok_routing_prefs
  DROP CONSTRAINT IF EXISTS org_byok_routing_prefs_freebuff_model_chk;

ALTER TABLE org_byok_routing_prefs
  ADD CONSTRAINT org_byok_routing_prefs_freebuff_model_chk
  CHECK (
    freebuff_model IS NULL
    OR freebuff_model IN ('glm/glm-5.3-flash', 'mimo/mimo-2.5')
  );

COMMENT ON COLUMN org_byok_routing_prefs.use_platform_free_ai IS
  'When true and the org holds an active platform_relay grant, chat / agent / bugbot / async jobs use the platform FreeBuff relay before team keys. Isolation is per-request; the box never sees another team''s context.';

COMMENT ON COLUMN org_byok_routing_prefs.freebuff_model IS
  'One of the two unmetered FreeBuff slugs (glm/glm-5.3-flash, mimo/mimo-2.5). NULL means the platform default.';
