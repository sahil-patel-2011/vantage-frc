-- Background free-tier AI jobs (Pi / local relay): memory dreaming, overnight intel, bugbot scans.
-- Worker role processes queued rows; product UI can enqueue on-demand jobs per org.

CREATE TYPE free_relay_job_kind AS ENUM ('memory_dream', 'overnight_intel', 'bugbot_scan');
CREATE TYPE free_relay_job_status AS ENUM ('queued', 'running', 'completed', 'failed', 'skipped');

CREATE TABLE free_relay_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind free_relay_job_kind NOT NULL,
  status free_relay_job_status NOT NULL DEFAULT 'queued',
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX free_relay_jobs_queue_idx
  ON free_relay_jobs (status, scheduled_for)
  WHERE status = 'queued';

CREATE INDEX free_relay_jobs_org_kind_idx
  ON free_relay_jobs (org_id, kind, created_at DESC);

ALTER TABLE free_relay_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY free_relay_jobs_member_read ON free_relay_jobs
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY free_relay_jobs_member_insert ON free_relay_jobs
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON free_relay_jobs TO vantage_app, vantage_worker;
