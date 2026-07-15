CREATE OR REPLACE FUNCTION claim_fusion_cad_job(device_hash text,new_lease_hash text)
RETURNS TABLE(job_id uuid,step_id uuid,org_id uuid,user_id uuid,device_id uuid,machine_name text,operation text,parameters jsonb,idempotency_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d cad_relay_devices%ROWTYPE;j cad_jobs%ROWTYPE;s cad_job_steps%ROWTYPE;
BEGIN
 SELECT * INTO d FROM cad_relay_devices WHERE token_hash=device_hash AND revoked_at IS NULL AND platform='fusion360'
  AND 'cad.jobs.claim'=ANY(scopes) FOR UPDATE;
 IF d.id IS NULL THEN RAISE EXCEPTION 'Device is invalid or not authorized to claim Fusion jobs';END IF;
 SELECT * INTO j FROM cad_jobs WHERE org_id=d.org_id AND created_by=d.user_id AND platform='fusion360' AND execution_mode='local'
  AND brief_confirmed_at IS NOT NULL AND cancel_requested_at IS NULL
  AND (lease_expires_at IS NULL OR lease_expires_at<now() OR lease_owner=d.id::text)
  AND EXISTS(SELECT 1 FROM cad_job_steps x WHERE x.job_id=cad_jobs.id AND x.org_id=d.org_id AND x.status='planned' AND x.approval_status='approved')
  ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF j.id IS NULL THEN RETURN;END IF;
 SELECT * INTO s FROM cad_job_steps WHERE cad_job_steps.job_id=j.id AND org_id=d.org_id AND status='planned' AND approval_status='approved' ORDER BY sequence LIMIT 1 FOR UPDATE;
 UPDATE cad_jobs SET lease_owner=d.id::text,lease_token_hash=new_lease_hash,lease_expires_at=now()+interval '2 minutes',last_heartbeat_at=now(),status='running',updated_at=now() WHERE id=j.id;
 UPDATE cad_job_steps SET status='running',started_at=COALESCE(started_at,now()),progress=1 WHERE id=s.id;
 RETURN QUERY SELECT j.id,s.id,d.org_id,d.user_id,d.id,d.machine_name,s.operation,s.parameters,s.idempotency_key;
END $$;
CREATE OR REPLACE FUNCTION update_fusion_cad_job(device_hash text,lease_hash text,target_job uuid,target_step uuid,new_state text,new_progress integer,result jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d cad_relay_devices%ROWTYPE;
BEGIN
 SELECT * INTO d FROM cad_relay_devices WHERE token_hash=device_hash AND revoked_at IS NULL AND platform='fusion360' FOR UPDATE;
 IF d.id IS NULL OR NOT EXISTS(SELECT 1 FROM cad_jobs j WHERE j.id=target_job AND j.org_id=d.org_id AND j.created_by=d.user_id AND j.lease_owner=d.id::text AND j.lease_token_hash=lease_hash AND j.lease_expires_at>now()) THEN RAISE EXCEPTION 'Fusion job lease is invalid or expired';END IF;
 UPDATE cad_job_steps SET status=new_state,progress=greatest(0,least(100,new_progress)),output=CASE WHEN result IS NULL THEN output ELSE result END,
  completed_at=CASE WHEN new_state='completed' THEN now() ELSE completed_at END WHERE id=target_step AND job_id=target_job AND org_id=d.org_id;
 UPDATE cad_jobs SET last_heartbeat_at=now(),lease_expires_at=now()+interval '2 minutes',updated_at=now() WHERE id=target_job;
 UPDATE cad_relay_devices SET last_seen_at=now(),status='online',updated_at=now() WHERE id=d.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION claim_fusion_cad_job(text,text),update_fusion_cad_job(text,text,uuid,uuid,text,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_fusion_cad_job(text,text),update_fusion_cad_job(text,text,uuid,uuid,text,integer,jsonb) TO vantage_pairing;
