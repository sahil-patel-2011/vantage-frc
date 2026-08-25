-- AI bridge full-platform coverage: one member's Claude Pro/Max (or ChatGPT/Codex)
-- subscription can serve EVERY Vantage AI feature, not just interactive chat.
--
-- coverage on the device decides the blast radius, chosen by the person who paired it:
--   'chat'       (default) — interactive chat-class features only (the 0486 behavior)
--   'everything' — all AI features platform-wide route through this subscription when
--                  the device is online, including long jobs (season reports, dreams,
--                  CAD plans, bugbot triage). Falls through to the org's key chain on
--                  any bridge failure, exactly like chat does.
ALTER TABLE ai_bridge_devices
  ADD COLUMN coverage text NOT NULL DEFAULT 'chat'
  CHECK (coverage IN ('chat', 'everything'));

-- Nightly/worker jobs (dreams, performance emails, parent digests) resolve their model
-- under vantage_worker; with 'everything' coverage they too must be able to see whether
-- a bridge device is online. Read-only — workers still cannot touch pairing or jobs
-- tables directly (enqueue rides the vantage_pairing pool, results ride SECURITY
-- DEFINER functions).
GRANT SELECT ON ai_bridge_devices TO vantage_worker;

-- Long jobs need a lease that outlasts the CLI run. The web enqueues the per-job CLI
-- budget as messages->>'timeoutMs' (clamped device-side too); the lease becomes that
-- budget plus a 60s reporting margin, never below the original 2 minutes. Queue expiry
-- stays at 120s: an online device claims within seconds, and a job nobody claims fast
-- should fail fast. Same signature as 0486, so CREATE OR REPLACE is safe.
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
   ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF j.id IS NULL THEN RETURN; END IF;
  -- Guard the cast: a single malformed timeoutMs would otherwise raise
  -- invalid_text_representation and abort this claim for EVERY job in the org, so the
  -- paired device would silently stop serving. Non-numeric text is treated as absent.
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
