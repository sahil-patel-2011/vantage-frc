-- AI subscription bridge: a team member who already pays for Claude Pro/Max (Claude Code CLI)
-- or ChatGPT (Codex CLI) pairs an always-on computer that executes the team's interactive AI
-- chat jobs through that CLI under SUBSCRIPTION auth — $0 API cost to the team.
--
-- Mirrors the CAD relay pairing architecture (0017/0018) and storage nodes (0484): human
-- pairing code, sha256-hashed device tokens, the vantage_pairing role for unauthenticated
-- device traffic, and SECURITY DEFINER claim/complete functions so the device role never
-- gets raw table access beyond its lease.
--
-- Honesty rules baked in: liveness is DERIVED from last_heartbeat_at; engine availability
-- and versions come only from device heartbeats (empty until the first one); a queued job
-- older than 120 seconds expires so the web caller never waits forever.

DO $$ BEGIN CREATE ROLE vantage_pairing NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO vantage_pairing;

-- Ledger label for bridge-executed turns (usable by billing once its union learns it).
ALTER TYPE key_source ADD VALUE IF NOT EXISTS 'subscription_bridge';

CREATE TABLE ai_bridge_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  paired_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- sha256 hex of the cloud-issued device token. Plaintext lives only on the device.
  token_hash text UNIQUE NOT NULL,
  -- Reported by heartbeats, e.g. {"claude": {"available": true, "version": "2.1.241",
  -- "authenticated": true}, "codex": {"available": false}}. Empty until the first heartbeat.
  engines jsonb NOT NULL DEFAULT '{}'::jsonb,
  bridge_version text,
  -- When true and the device heartbeat is fresh, chat-class features try the bridge first.
  prefer_when_online boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'paired' CHECK (status IN ('paired', 'online')),
  last_heartbeat_at timestamptz,
  jobs_served integer NOT NULL DEFAULT 0 CHECK (jobs_served >= 0),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_bridge_devices_org_idx ON ai_bridge_devices(org_id);

CREATE TABLE ai_bridge_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_code_hash text UNIQUE NOT NULL,
  poll_token_hash text UNIQUE NOT NULL,
  machine_name text NOT NULL,
  bridge_version text NOT NULL,
  approved_org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  approved_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES ai_bridge_devices(id) ON DELETE SET NULL,
  encrypted_device_token text,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_bridge_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  feature text NOT NULL,
  -- {"prompt": "<single prompt document>"} — size-capped so a runaway context can never
  -- park megabytes in the queue.
  messages jsonb NOT NULL CHECK (pg_column_size(messages) <= 262144),
  -- NULL = any available engine; otherwise 'claude' | 'codex'.
  requested_engine text CHECK (requested_engine IS NULL OR requested_engine IN ('claude', 'codex')),
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'leased', 'done', 'failed', 'expired')),
  device_id uuid REFERENCES ai_bridge_devices(id) ON DELETE SET NULL,
  lease_token_hash text,
  lease_expires_at timestamptz,
  -- {"text": ..., "model": ..., "usage": {"inputTokens": n, "outputTokens": n}} from the CLI.
  result jsonb CHECK (result IS NULL OR pg_column_size(result) <= 262144),
  -- 'rate_limited' | 'not_authenticated' | 'cli_error' | 'cli_timeout' | 'lease_expired' …
  error_class text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  leased_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX ai_bridge_jobs_org_queue_idx ON ai_bridge_jobs(org_id, created_at) WHERE state = 'queued';
CREATE INDEX ai_bridge_jobs_org_recent_idx ON ai_bridge_jobs(org_id, created_at DESC);

ALTER TABLE ai_bridge_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_bridge_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_bridge_jobs ENABLE ROW LEVEL SECURITY;

-- App role: every member sees the team's bridge; owners/admins (or the pairer) manage it.
CREATE POLICY ai_bridge_devices_member_read ON ai_bridge_devices FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY ai_bridge_devices_manage ON ai_bridge_devices FOR UPDATE TO vantage_app
  USING (paired_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (paired_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY ai_bridge_pairing_approve_read ON ai_bridge_pairing_codes FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY ai_bridge_pairing_approve_update ON ai_bridge_pairing_codes FOR UPDATE TO vantage_app
  USING (approved_user_id IS NULL AND consumed_at IS NULL AND expires_at > now())
  WITH CHECK (approved_user_id = current_app_user_id() AND is_org_member(approved_org_id));
CREATE POLICY ai_bridge_jobs_member_read ON ai_bridge_jobs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Pairing role (server-side pairing/relay pool + SECURITY DEFINER functions).
CREATE POLICY ai_bridge_pairing_service_all ON ai_bridge_pairing_codes
  TO vantage_pairing USING (true) WITH CHECK (true);
CREATE POLICY ai_bridge_devices_service_all ON ai_bridge_devices
  TO vantage_pairing USING (true) WITH CHECK (true);
CREATE POLICY ai_bridge_jobs_service_all ON ai_bridge_jobs
  TO vantage_pairing USING (true) WITH CHECK (true);

GRANT SELECT, UPDATE ON ai_bridge_devices, ai_bridge_pairing_codes TO vantage_app;
GRANT SELECT ON ai_bridge_jobs TO vantage_app;
GRANT SELECT, INSERT, UPDATE ON ai_bridge_devices, ai_bridge_pairing_codes, ai_bridge_jobs TO vantage_pairing;

-- Claim the oldest runnable queued job for the device's org. Also enforces the two honesty
-- timers: queued jobs older than 120s expire, and leased jobs whose lease lapsed fail with
-- error_class 'lease_expired' so the web poller falls through instead of waiting forever.
CREATE OR REPLACE FUNCTION claim_ai_bridge_job(device_hash text, new_lease_hash text)
RETURNS TABLE(job_id uuid, org_id uuid, feature text, messages jsonb, requested_engine text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d ai_bridge_devices%ROWTYPE; j ai_bridge_jobs%ROWTYPE;
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
  UPDATE ai_bridge_jobs SET state = 'leased', device_id = d.id, lease_token_hash = new_lease_hash,
         lease_expires_at = now() + interval '2 minutes', leased_at = now()
   WHERE id = j.id;
  RETURN QUERY SELECT j.id, j.org_id, j.feature, j.messages, j.requested_engine;
END $$;

-- Finish a leased job (done|failed). Validates the device token + lease before writing.
CREATE OR REPLACE FUNCTION complete_ai_bridge_job(
  device_hash text, lease_hash text, target_job uuid,
  new_state text, new_result jsonb, new_error_class text, new_error_message text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d ai_bridge_devices%ROWTYPE;
BEGIN
  IF new_state NOT IN ('done', 'failed') THEN RAISE EXCEPTION 'Bridge jobs finish as done or failed'; END IF;
  SELECT * INTO d FROM ai_bridge_devices
   WHERE token_hash = device_hash AND revoked_at IS NULL FOR UPDATE;
  IF d.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM ai_bridge_jobs j
     WHERE j.id = target_job AND j.org_id = d.org_id AND j.device_id = d.id
       AND j.state = 'leased' AND j.lease_token_hash = lease_hash AND j.lease_expires_at > now()
  ) THEN RAISE EXCEPTION 'Bridge job lease is invalid or expired'; END IF;
  UPDATE ai_bridge_jobs SET state = new_state, result = new_result,
         error_class = new_error_class, error_message = new_error_message, completed_at = now()
   WHERE id = target_job;
  UPDATE ai_bridge_devices SET last_heartbeat_at = now(), status = 'online', updated_at = now(),
         jobs_served = jobs_served + (CASE WHEN new_state = 'done' THEN 1 ELSE 0 END)
   WHERE id = d.id;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION claim_ai_bridge_job(text, text),
  complete_ai_bridge_job(text, text, uuid, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_ai_bridge_job(text, text),
  complete_ai_bridge_job(text, text, uuid, text, jsonb, text, text) TO vantage_pairing;
