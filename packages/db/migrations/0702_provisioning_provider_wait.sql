-- A durable provider wait is distinct from failed or actively running setup.
ALTER TABLE team_provisioning_jobs DROP CONSTRAINT team_provisioning_jobs_state_check;
ALTER TABLE team_provisioning_jobs ADD CONSTRAINT team_provisioning_jobs_state_check
  CHECK(state IN ('queued','running','waiting','failed','ready'));
ALTER TABLE team_provisioning_jobs ADD COLUMN retry_after_at timestamptz;
