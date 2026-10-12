-- Agents take long goals and write long answers: a goal can be a pasted spec or a file, and an
-- answer can be a whole plan, report or file. The old checks (4,000 / 16,000 / 8,000 characters)
-- cut both off. These bounds keep a single row sane while leaving the model's own limits as the
-- real ceiling. Constants: packages/agent/src/autonomous-agent-store.ts.
ALTER TABLE autonomous_agent_runs DROP CONSTRAINT IF EXISTS autonomous_agent_runs_goal_check;
ALTER TABLE autonomous_agent_runs
  ADD CONSTRAINT autonomous_agent_runs_goal_check CHECK (char_length(goal) BETWEEN 1 AND 100000);

ALTER TABLE autonomous_agent_runs DROP CONSTRAINT IF EXISTS autonomous_agent_runs_final_answer_check;
ALTER TABLE autonomous_agent_runs
  ADD CONSTRAINT autonomous_agent_runs_final_answer_check
  CHECK (final_answer IS NULL OR char_length(final_answer) <= 400000);

ALTER TABLE autonomous_agent_steps DROP CONSTRAINT IF EXISTS autonomous_agent_steps_result_excerpt_check;
ALTER TABLE autonomous_agent_steps
  ADD CONSTRAINT autonomous_agent_steps_result_excerpt_check
  CHECK (result_excerpt IS NULL OR char_length(result_excerpt) <= 32000);
