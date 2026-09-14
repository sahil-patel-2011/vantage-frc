-- Personal Claude Code: a member's own terminal can serve THAT member's web
-- turns only (OpenClaw-style, $0 API cost). Team subscription-bridge devices
-- stay org-shared. Personal devices never pick up another person's jobs.
ALTER TABLE ai_bridge_devices
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'team'
  CHECK (scope IN ('team', 'personal'));

CREATE INDEX IF NOT EXISTS ai_bridge_devices_personal_idx
  ON ai_bridge_devices(paired_by)
  WHERE scope = 'personal' AND revoked_at IS NULL;

-- Same signature as 0488 so CREATE OR REPLACE is safe.
CREATE OR REPLACE FUNCTION claim_ai_bridge_job(device_hash text, new_lease_hash text)
RETURNS TABLE(job_id uuid, org_id uuid, feature text, messages jsonb, requested_engine text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d ai_bridge_devices%ROWTYPE; j ai_bridge_jobs%ROWTYPE; lease interval;
BEGIN
  SELECT * INTO d FROM ai_bridge_devices
   WHERE token_hash = device_hash AND revoked_at IS NULL FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Bridge device is invalid or revoked'; END IF;
  UPDATE ai_bridge_devices SET last_heartbeat_at = now(), status = 'online', updated_at = now()
   WHERE id = d.id;
  UPDATE ai_bridge_jobs SET state = 'expired', completed_at = now(),
         error_class = 'queue_expired', error_message = 'No bridge device claimed this job within 120 seconds.'
   WHERE ai_bridge_jobs.org_id = d.org_id AND state = 'queued' AND created_at < now() - interval '120 seconds';
  UPDATE ai_bridge_jobs SET state = 'failed', completed_at = now(),
         error_class = 'lease_expired', error_message = 'The bridge device stopped responding mid-job.'
   WHERE ai_bridge_jobs.org_id = d.org_id AND state = 'leased' AND lease_expires_at < now();
  SELECT * INTO j FROM ai_bridge_jobs
   WHERE ai_bridge_jobs.org_id = d.org_id AND state = 'queued'
     AND created_at >= now() - interval '120 seconds'
     AND (ai_bridge_jobs.requested_engine IS NULL
          OR COALESCE((d.engines -> ai_bridge_jobs.requested_engine ->> 'available')::boolean, false))
     AND (
       COALESCE((to_jsonb(d) ->> 'scope'), 'team') <> 'personal'
       OR ai_bridge_jobs.user_id = d.paired_by
     )
   ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF j.id IS NULL THEN RETURN; END IF;
  lease := GREATEST(
    interval '2 minutes',
    make_interval(secs => LEAST(
      CASE WHEN j.messages ->> 'timeoutMs' ~ '^[0-9]+([.][0-9]+)?$'
           THEN (j.messages ->> 'timeoutMs')::numeric ELSE 0 END / 1000.0, 300) + 60)
  );
  UPDATE ai_bridge_jobs SET state = 'leased', device_id = d.id, lease_token_hash = new_lease_hash,
         lease_expires_at = now() + lease, leased_at = now()
   WHERE id = j.id;
  RETURN QUERY SELECT j.id, j.org_id, j.feature, j.messages, j.requested_engine;
END $$;
