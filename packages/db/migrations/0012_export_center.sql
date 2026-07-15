CREATE TABLE export_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 requested_by uuid NOT NULL REFERENCES users(id),scope text NOT NULL CHECK(scope IN ('team','private')),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed','cancelled','expired')),
 domains text[] NOT NULL,filters jsonb NOT NULL DEFAULT '{}',progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 object_key text,encrypted_archive text,download_token_hash text,expires_at timestamptz,cancel_requested_at timestamptz,
 error text,size_bytes integer,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX export_jobs_org_created_idx ON export_jobs(org_id,created_at);
CREATE TABLE export_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 job_id uuid REFERENCES export_jobs(id) ON DELETE SET NULL,actor_user_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL,reason text,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX export_audit_org_created_idx ON export_audit_events(org_id,created_at);
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;ALTER TABLE export_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY export_jobs_read ON export_jobs FOR SELECT TO vantage_app USING(
  requested_by=current_app_user_id() OR (scope='team' AND has_org_role(org_id,ARRAY['owner','admin']::org_role[])) OR is_platform_admin());
CREATE POLICY export_jobs_create ON export_jobs FOR INSERT TO vantage_app WITH CHECK(
  requested_by=current_app_user_id() AND is_org_member(org_id) AND (scope='private' OR has_org_role(org_id,ARRAY['owner','admin']::org_role[])));
CREATE POLICY export_jobs_update ON export_jobs FOR UPDATE TO vantage_app USING(requested_by=current_app_user_id() OR is_platform_admin())
 WITH CHECK(requested_by=current_app_user_id() OR is_platform_admin());
CREATE POLICY export_audit_insert ON export_audit_events FOR INSERT TO vantage_app WITH CHECK(actor_user_id=current_app_user_id());
CREATE POLICY export_audit_read ON export_audit_events FOR SELECT TO vantage_app USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) OR actor_user_id=current_app_user_id() OR is_platform_admin());
GRANT SELECT,INSERT,UPDATE,DELETE ON export_jobs,export_audit_events TO vantage_app,vantage_worker;
