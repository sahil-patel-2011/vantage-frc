-- Terminal (vantage-cad CLI / Claude Code MCP) session sync into the same cad_jobs
-- storage the web CAD agent uses. No new table: a CLI session is a cad_jobs row with
-- brief->>'kind'='cad_cli' (the web agent writes brief->>'kind'='cad_agent'), so the
-- /cad activity list reads one org-scoped, RLS-protected table for both sources.
--
-- The CLI authenticates with its paired device token (cad_relay_devices.token_hash,
-- migration 0017). That connection runs as role vantage_pairing, which has no grants
-- on cad_jobs — so, exactly like the fusion job-lease functions in 0018, the write
-- goes through a SECURITY DEFINER function that first validates the device token
-- hash and then only ever touches rows for that device's own org and user.
CREATE OR REPLACE FUNCTION record_cad_cli_session(
  device_hash text,
  session_key text,
  event_platform text,
  doc_ref jsonb,
  event jsonb,
  session_status text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  d cad_relay_devices%ROWTYPE;
  j cad_jobs%ROWTYPE;
  calls jsonb;
  safe_platform text;
  job_status text;
BEGIN
  SELECT * INTO d FROM cad_relay_devices
   WHERE token_hash=device_hash AND revoked_at IS NULL FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device token is invalid or revoked'; END IF;
  IF session_key IS NULL OR length(session_key) NOT BETWEEN 8 AND 64
     OR session_key !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Invalid session key';
  END IF;
  IF session_status NOT IN ('running','completed','failed') THEN
    RAISE EXCEPTION 'Invalid session status';
  END IF;
  IF event IS NOT NULL AND (jsonb_typeof(event) <> 'object' OR length(event::text) > 4000) THEN
    RAISE EXCEPTION 'Invalid session event';
  END IF;
  IF doc_ref IS NOT NULL AND (jsonb_typeof(doc_ref) <> 'object' OR length(doc_ref::text) > 2000) THEN
    RAISE EXCEPTION 'Invalid document ref';
  END IF;
  safe_platform := CASE WHEN event_platform IN ('onshape','fusion360') THEN event_platform ELSE d.platform END;
  job_status := session_status;

  SELECT * INTO j FROM cad_jobs
   WHERE org_id=d.org_id AND created_by=d.user_id
     AND brief->>'kind'='cad_cli' AND brief->>'sessionId'=session_key
   FOR UPDATE;

  IF j.id IS NULL THEN
    INSERT INTO cad_jobs(org_id,created_by,execution_mode,platform,title,status,brief,document_ref,completed_at)
    VALUES(
      d.org_id, d.user_id, 'local', safe_platform,
      'Terminal CAD session', job_status,
      jsonb_build_object(
        'kind','cad_cli',
        'sessionId',session_key,
        'machineName',left(d.machine_name,100),
        'deviceId',d.id::text,
        'toolCalls',CASE WHEN event IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(event) END
      ),
      doc_ref,
      CASE WHEN job_status IN ('completed','failed') THEN now() ELSE NULL END
    )
    RETURNING * INTO j;
  ELSE
    calls := COALESCE(j.brief->'toolCalls','[]'::jsonb);
    IF event IS NOT NULL THEN calls := calls || jsonb_build_array(event); END IF;
    IF jsonb_array_length(calls) > 40 THEN
      SELECT jsonb_agg(value ORDER BY ord) INTO calls
      FROM (
        SELECT value, ord FROM jsonb_array_elements(calls) WITH ORDINALITY AS t(value,ord)
        ORDER BY ord DESC LIMIT 40
      ) trimmed;
    END IF;
    UPDATE cad_jobs SET
      platform=safe_platform,
      status=job_status,
      brief=jsonb_set(j.brief,'{toolCalls}',calls),
      document_ref=COALESCE(doc_ref,j.document_ref),
      completed_at=CASE WHEN job_status IN ('completed','failed') THEN now() ELSE completed_at END,
      updated_at=now()
    WHERE id=j.id;
  END IF;

  UPDATE cad_relay_devices SET last_seen_at=now(),status='online',updated_at=now() WHERE id=d.id;
  RETURN j.id;
END $$;

REVOKE ALL ON FUNCTION record_cad_cli_session(text,text,text,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_cad_cli_session(text,text,text,jsonb,jsonb,text) TO vantage_pairing;
