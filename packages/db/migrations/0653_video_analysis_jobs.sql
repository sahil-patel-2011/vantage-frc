-- Video analysis jobs on the video-role Pi. Same lease/heartbeat/checkpoint/cancel
-- shape as free_relay_jobs / assembly_manual_runs. Findings are provenance, never
-- silently merged into scouted numbers.

DO $$ BEGIN
  CREATE TYPE video_analysis_job_status AS ENUM (
    'queued', 'running', 'completed', 'failed', 'cancelled', 'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE video_analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_by uuid NOT NULL REFERENCES users(id),
  source_kind text NOT NULL CHECK (source_kind IN ('tba', 'youtube', 'upload', 'pit_stream')),
  source_ref text NOT NULL,
  match_key text,
  status video_analysis_job_status NOT NULL DEFAULT 'queued',
  lease_owner text,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  result jsonb,
  minutes_behind integer CHECK (minutes_behind IS NULL OR minutes_behind >= 0),
  cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX video_analysis_jobs_queue_idx
  ON video_analysis_jobs (status, created_at)
  WHERE status = 'queued';
CREATE INDEX video_analysis_jobs_org_idx ON video_analysis_jobs (org_id, created_at DESC);

ALTER TABLE video_analysis_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY video_analysis_jobs_member_read ON video_analysis_jobs
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY video_analysis_jobs_member_insert ON video_analysis_jobs
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND started_by = current_app_user_id());

CREATE POLICY video_analysis_jobs_author_cancel ON video_analysis_jobs
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND (started_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY video_analysis_jobs_worker_all ON video_analysis_jobs
  FOR ALL TO vantage_worker
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON video_analysis_jobs TO vantage_app, vantage_worker;
