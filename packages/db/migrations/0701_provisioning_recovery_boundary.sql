-- Retries must wait for the same initial record boundary, not their own latest status write.
ALTER TABLE team_provisioning_jobs ADD COLUMN recovery_boundary_at timestamptz;
