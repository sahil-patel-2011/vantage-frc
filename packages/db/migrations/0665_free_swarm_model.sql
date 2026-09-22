-- Which free-swarm model a team wants.
--
-- Vantage's free AI path is a volunteer swarm. Petals was that swarm until it
-- was measured empty (2026-09-19: `MissingBlocksError: No servers holding
-- blocks [0..79] are online`, health monitor down, upstream last touched in
-- September 2024). AI Horde is the same idea with people still in it, and it
-- hosts several models at once, so a team can say which of ours it prefers —
-- the smallest answers fastest, the largest answers best, and on volunteer
-- hardware that is a real trade rather than a detail.
--
-- Stored beside the BYOK routing preferences because it is the same question
-- asked of a different pool: which model, for this team.
--
-- NULL means "any of them", which is also the default. That is not the same as
-- "any model the swarm hosts": the set Vantage will accept is an allowlist in
-- `packages/agent/src/ai-horde-pool.ts`, and a value here that is not on it is
-- ignored rather than honoured. The swarm's large models are roleplay and
-- deliberately-uncensored community builds, so the allowlist is a safety
-- mechanism and this column is only a preference within it. A CHECK constraint
-- is deliberately not used: the allowlist changes when volunteers come and go,
-- and a migration is the wrong place to pin that.

ALTER TABLE org_byok_routing_prefs
  ADD COLUMN IF NOT EXISTS free_swarm_model text;

COMMENT ON COLUMN org_byok_routing_prefs.free_swarm_model IS
  'Preferred AI Horde model id, or NULL for any on the allowlist. Validated in application code against AI_HORDE_MODEL_IDS, never here.';
