-- 0427 stored max_steps DEFAULT 8 CHECK (1..20). The loop now defaults to 24
-- hops and hard-caps at 48 — an INSERT of 24 would fail at the database.

ALTER TABLE autonomous_agent_runs
  DROP CONSTRAINT IF EXISTS autonomous_agent_runs_max_steps_check;

ALTER TABLE autonomous_agent_runs
  ALTER COLUMN max_steps SET DEFAULT 24;

ALTER TABLE autonomous_agent_runs
  ADD CONSTRAINT autonomous_agent_runs_max_steps_check
  CHECK (max_steps BETWEEN 1 AND 48);
