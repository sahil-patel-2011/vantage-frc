-- Personal subscriptions may only serve the person who paired the device.
DROP POLICY IF EXISTS ai_bridge_devices_member_read ON ai_bridge_devices;
CREATE POLICY ai_bridge_devices_member_read ON ai_bridge_devices FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND paired_by = current_app_user_id());
DROP POLICY IF EXISTS ai_bridge_devices_manage ON ai_bridge_devices;
CREATE POLICY ai_bridge_devices_manage ON ai_bridge_devices FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND paired_by = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND paired_by = current_app_user_id());
DROP POLICY IF EXISTS ai_bridge_jobs_member_read ON ai_bridge_jobs;
CREATE POLICY ai_bridge_jobs_member_read ON ai_bridge_jobs FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND requested_by = current_app_user_id());
CREATE INDEX IF NOT EXISTS ai_bridge_jobs_personal_queue_idx
  ON ai_bridge_jobs(org_id, requested_by, created_at) WHERE state = 'queued';

UPDATE ai_bridge_jobs j SET state = 'expired', completed_at = now(),
  error_class = 'personal_connection_required', error_message = 'Reconnect using your own personal device.'
  WHERE state IN ('queued','leased') AND (requested_by IS NULL OR EXISTS (
    SELECT 1 FROM ai_bridge_devices d WHERE d.id=j.device_id AND d.paired_by IS DISTINCT FROM j.requested_by
  ));

CREATE OR REPLACE FUNCTION claim_ai_bridge_job(device_hash text, new_lease_hash text)
RETURNS TABLE(job_id uuid, org_id uuid, feature text, messages jsonb, requested_engine text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d ai_bridge_devices%ROWTYPE; j ai_bridge_jobs%ROWTYPE; lease interval;
BEGIN
  SELECT * INTO d FROM ai_bridge_devices WHERE token_hash=device_hash AND revoked_at IS NULL FOR UPDATE;
  IF d.id IS NULL OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=d.org_id AND m.user_id=d.paired_by)
    OR EXISTS(SELECT 1 FROM profiles p WHERE p.user_id=d.paired_by AND p.date_of_birth>(CURRENT_DATE-interval '13 years')::date) THEN
    RAISE EXCEPTION 'Personal device is invalid, revoked, or no longer a team member';
  END IF;
  UPDATE ai_bridge_devices SET last_heartbeat_at=now(), status='online', updated_at=now() WHERE id=d.id;
  UPDATE ai_bridge_jobs SET state='expired', completed_at=now(), error_class='queue_expired',
    error_message='Your personal device did not claim this request in time.'
    WHERE ai_bridge_jobs.org_id=d.org_id AND requested_by=d.paired_by AND state='queued' AND created_at<now()-interval '120 seconds';
  UPDATE ai_bridge_jobs SET state='failed', completed_at=now(), error_class='lease_expired',
    error_message='Your personal device stopped responding.'
    WHERE ai_bridge_jobs.org_id=d.org_id AND requested_by=d.paired_by AND state='leased' AND lease_expires_at<now();
  SELECT * INTO j FROM ai_bridge_jobs WHERE ai_bridge_jobs.org_id=d.org_id AND requested_by=d.paired_by AND state='queued'
    AND created_at>=now()-interval '120 seconds'
    AND (ai_bridge_jobs.requested_engine IS NULL OR COALESCE((d.engines->ai_bridge_jobs.requested_engine->>'available')::boolean,false))
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF j.id IS NULL THEN RETURN; END IF;
  lease := GREATEST(interval '2 minutes', make_interval(secs => LEAST(
    CASE WHEN j.messages->>'timeoutMs' ~ '^[0-9]+([.][0-9]+)?$' THEN (j.messages->>'timeoutMs')::numeric ELSE 0 END/1000.0,300)+60));
  UPDATE ai_bridge_jobs SET state='leased', device_id=d.id, lease_token_hash=new_lease_hash,
    lease_expires_at=now()+lease, leased_at=now() WHERE id=j.id;
  RETURN QUERY SELECT j.id,j.org_id,j.feature,j.messages,j.requested_engine;
END $$;

CREATE OR REPLACE FUNCTION complete_ai_bridge_job(
  device_hash text, lease_hash text, target_job uuid,
  new_state text, new_result jsonb, new_error_class text, new_error_message text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d ai_bridge_devices%ROWTYPE;
BEGIN
  IF new_state NOT IN ('done','failed') THEN RAISE EXCEPTION 'Bridge jobs finish as done or failed'; END IF;
  SELECT * INTO d FROM ai_bridge_devices WHERE token_hash=device_hash AND revoked_at IS NULL FOR UPDATE;
  IF d.id IS NULL OR NOT EXISTS(SELECT 1 FROM memberships m WHERE m.org_id=d.org_id AND m.user_id=d.paired_by)
    OR EXISTS(SELECT 1 FROM profiles p WHERE p.user_id=d.paired_by AND p.date_of_birth>(CURRENT_DATE-interval '13 years')::date)
    OR NOT EXISTS(SELECT 1 FROM ai_bridge_jobs j WHERE j.id=target_job AND j.org_id=d.org_id
      AND j.requested_by=d.paired_by AND j.device_id=d.id AND j.state='leased'
      AND j.lease_token_hash=lease_hash AND j.lease_expires_at>now()) THEN
    RAISE EXCEPTION 'Personal bridge job lease is invalid or expired';
  END IF;
  UPDATE ai_bridge_jobs SET state=new_state,result=new_result,error_class=new_error_class,
    error_message=new_error_message,completed_at=now() WHERE id=target_job;
  UPDATE ai_bridge_devices SET last_heartbeat_at=now(),status='online',updated_at=now(),
    jobs_served=jobs_served+(CASE WHEN new_state='done' THEN 1 ELSE 0 END) WHERE id=d.id;
  RETURN true;
END $$;
