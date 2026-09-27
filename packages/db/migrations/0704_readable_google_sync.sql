CREATE TABLE team_readable_sync_jobs (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  generation uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('queued','running','waiting','failed','ready')),
  workflow_run_id text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  retry_after_at timestamptz,
  error text,
  completed_workbooks jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE team_readable_sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY readable_sync_member_read ON team_readable_sync_jobs FOR SELECT TO vantage_app
  USING(is_org_member(org_id));
CREATE POLICY readable_sync_worker ON team_readable_sync_jobs TO vantage_worker
  USING(true) WITH CHECK(true);
GRANT SELECT ON team_readable_sync_jobs TO vantage_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON team_readable_sync_jobs TO vantage_worker;
-- Recovery's coverage guard must include this operational state; restore disables jobs.
SELECT install_recovery_capture();
