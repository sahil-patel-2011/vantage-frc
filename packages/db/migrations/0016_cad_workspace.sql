CREATE TABLE cad_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,platform text NOT NULL CHECK(platform IN ('onshape','fusion360')),
 execution_mode text NOT NULL CHECK(execution_mode IN ('hosted','local')),label text NOT NULL,encrypted_credentials text,
 scopes text[] NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'disconnected',external_account_ref text,last_tested_at timestamptz,
 disabled_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_connections_org_user_idx ON cad_connections(org_id,user_id);
CREATE TABLE cad_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES users(id),thread_id uuid REFERENCES agent_threads(id) ON DELETE SET NULL,
 connection_id uuid REFERENCES cad_connections(id) ON DELETE SET NULL,execution_mode text NOT NULL CHECK(execution_mode IN ('hosted','local')),
 platform text NOT NULL CHECK(platform IN ('onshape','fusion360','mock')),title text NOT NULL,status text NOT NULL DEFAULT 'draft',
 brief jsonb NOT NULL,brief_confirmed_at timestamptz,action_plan jsonb NOT NULL DEFAULT '[]',document_ref jsonb,
 current_checkpoint_id uuid,cancel_requested_at timestamptz,lease_owner text,lease_token_hash text,lease_expires_at timestamptz,
 last_heartbeat_at timestamptz,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_jobs_org_updated_idx ON cad_jobs(org_id,updated_at);
CREATE TABLE cad_job_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES cad_jobs(id) ON DELETE CASCADE,sequence integer NOT NULL,operation text NOT NULL,
 idempotency_key text UNIQUE NOT NULL,parameters jsonb NOT NULL,status text NOT NULL DEFAULT 'planned',
 requires_approval boolean NOT NULL DEFAULT true,approval_status text NOT NULL DEFAULT 'pending',approved_by uuid REFERENCES users(id),
 approved_at timestamptz,progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),output jsonb,error text,
 started_at timestamptz,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(job_id,sequence)
);
CREATE TABLE cad_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES cad_jobs(id) ON DELETE CASCADE,step_id uuid REFERENCES cad_job_steps(id) ON DELETE SET NULL,
 type text NOT NULL,title text NOT NULL,version integer NOT NULL DEFAULT 1,parent_artifact_id uuid REFERENCES cad_artifacts(id) ON DELETE SET NULL,
 content jsonb NOT NULL DEFAULT '{}',storage_key text,checksum text NOT NULL,source_refs jsonb NOT NULL DEFAULT '[]',
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(storage_key IS NULL OR storage_key LIKE org_id::text||'/%')
);
CREATE INDEX cad_artifacts_org_job_idx ON cad_artifacts(org_id,job_id);
CREATE TABLE cad_checkpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 job_id uuid NOT NULL REFERENCES cad_jobs(id) ON DELETE CASCADE,step_id uuid REFERENCES cad_job_steps(id) ON DELETE SET NULL,
 external_version_ref text,branch_ref text,topology_fingerprint text NOT NULL,topology jsonb NOT NULL,
 render_artifact_id uuid REFERENCES cad_artifacts(id) ON DELETE SET NULL,human_edit_detected boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cad_jobs ADD CONSTRAINT cad_jobs_checkpoint_fk FOREIGN KEY(current_checkpoint_id) REFERENCES cad_checkpoints(id) ON DELETE SET NULL;
CREATE TABLE cad_mechanisms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 name text NOT NULL,category text NOT NULL,description text NOT NULL,requirements jsonb NOT NULL DEFAULT '{}',
 source_artifact_id uuid REFERENCES cad_artifacts(id) ON DELETE SET NULL,version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,name,version)
);
CREATE TABLE cad_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 job_id uuid REFERENCES cad_jobs(id) ON DELETE SET NULL,actor_user_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL,payload jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_audit_org_created_idx ON cad_audit_events(org_id,created_at);
ALTER TABLE cad_connections ENABLE ROW LEVEL SECURITY;ALTER TABLE cad_jobs ENABLE ROW LEVEL SECURITY;ALTER TABLE cad_job_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE cad_artifacts ENABLE ROW LEVEL SECURITY;ALTER TABLE cad_checkpoints ENABLE ROW LEVEL SECURITY;ALTER TABLE cad_mechanisms ENABLE ROW LEVEL SECURITY;ALTER TABLE cad_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY cad_connections_owner ON cad_connections FOR ALL TO vantage_app USING(org_id=current_app_org_id() AND user_id=current_app_user_id()) WITH CHECK(org_id=current_app_org_id() AND user_id=current_app_user_id());
CREATE POLICY cad_jobs_member_read ON cad_jobs FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY cad_jobs_creator_write ON cad_jobs FOR ALL TO vantage_app USING(org_id=current_app_org_id() AND (created_by=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[]))) WITH CHECK(org_id=current_app_org_id() AND (created_by=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[])));
CREATE POLICY cad_steps_member_read ON cad_job_steps FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY cad_steps_job_owner_write ON cad_job_steps FOR ALL TO vantage_app USING(EXISTS(SELECT 1 FROM cad_jobs j WHERE j.id=job_id AND j.org_id=org_id AND (j.created_by=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[])))) WITH CHECK(EXISTS(SELECT 1 FROM cad_jobs j WHERE j.id=job_id AND j.org_id=org_id AND (j.created_by=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[]))));
CREATE POLICY cad_artifacts_member_read ON cad_artifacts FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY cad_artifacts_job_owner_insert ON cad_artifacts FOR INSERT TO vantage_app WITH CHECK(EXISTS(SELECT 1 FROM cad_jobs j WHERE j.id=job_id AND j.org_id=org_id AND (j.created_by=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[]))));
CREATE POLICY cad_checkpoints_member_read ON cad_checkpoints FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY cad_checkpoints_job_owner_insert ON cad_checkpoints FOR INSERT TO vantage_app WITH CHECK(EXISTS(SELECT 1 FROM cad_jobs j WHERE j.id=job_id AND j.org_id=org_id AND (j.created_by=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[]))));
CREATE POLICY cad_mechanisms_member_read ON cad_mechanisms FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY cad_mechanisms_member_write ON cad_mechanisms FOR INSERT TO vantage_app WITH CHECK(is_org_member(org_id) AND created_by=current_app_user_id());
CREATE POLICY cad_audit_insert ON cad_audit_events FOR INSERT TO vantage_app WITH CHECK(org_id=current_app_org_id() AND actor_user_id=current_app_user_id());
CREATE POLICY cad_audit_read ON cad_audit_events FOR SELECT TO vantage_app USING(is_org_member(org_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON cad_connections,cad_jobs,cad_job_steps,cad_artifacts,cad_checkpoints,cad_mechanisms,cad_audit_events TO vantage_app,vantage_worker;
