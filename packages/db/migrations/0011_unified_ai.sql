-- Defined here because AI RLS policies need org context before 0014_tenant_storage_hardening.sql.
CREATE OR REPLACE FUNCTION current_app_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id',true),'')::uuid $$;
REVOKE ALL ON FUNCTION current_app_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_app_org_id() TO vantage_app, vantage_worker;

UPDATE agent_threads t SET org_id=(SELECT m.org_id FROM memberships m WHERE m.user_id=t.created_by ORDER BY m.created_at LIMIT 1) WHERE t.org_id IS NULL;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM agent_threads WHERE org_id IS NULL) THEN RAISE EXCEPTION 'Cannot migrate unscoped AI threads: assign an organization first';END IF;END $$;
ALTER TABLE agent_threads ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE agent_messages ADD COLUMN org_id uuid REFERENCES organizations(id) ON DELETE CASCADE;
UPDATE agent_messages m SET org_id=t.org_id FROM agent_threads t WHERE t.id=m.thread_id;
ALTER TABLE agent_messages ALTER COLUMN org_id SET NOT NULL;
CREATE INDEX agent_messages_org_thread_idx ON agent_messages(org_id,thread_id);
DROP POLICY threads_insert ON agent_threads;
CREATE POLICY threads_insert ON agent_threads FOR INSERT TO vantage_app
  WITH CHECK(created_by=current_app_user_id() AND is_org_member(org_id) AND scope IN ('private','team'));
DROP POLICY messages_read ON agent_messages;DROP POLICY messages_insert ON agent_messages;DROP POLICY messages_author_update ON agent_messages;
CREATE POLICY messages_read ON agent_messages FOR SELECT TO vantage_app USING(is_org_member(org_id) AND EXISTS(
 SELECT 1 FROM agent_threads t WHERE t.id=thread_id AND t.org_id=org_id AND (t.scope='team' OR t.created_by=current_app_user_id())));
CREATE POLICY messages_insert ON agent_messages FOR INSERT TO vantage_app WITH CHECK(is_org_member(org_id) AND EXISTS(
 SELECT 1 FROM agent_threads t WHERE t.id=thread_id AND t.org_id=org_id AND
 ((t.scope='private' AND t.created_by=current_app_user_id() AND author_user_id=current_app_user_id() AND NOT explicitly_shared)
 OR (t.scope='team' AND (author_user_id=current_app_user_id() OR author_user_id IS NULL) AND explicitly_shared))));
CREATE POLICY messages_author_update ON agent_messages FOR UPDATE TO vantage_app
 USING(org_id=current_app_org_id() AND author_user_id=current_app_user_id())
 WITH CHECK(org_id=current_app_org_id() AND author_user_id=current_app_user_id());

CREATE TABLE ai_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),thread_id uuid REFERENCES agent_threads(id) ON DELETE SET NULL,
 capability text NOT NULL,status text NOT NULL DEFAULT 'running',privacy_scope text NOT NULL,provider text,model text,
 request_id text UNIQUE NOT NULL,input jsonb NOT NULL DEFAULT '{}',output jsonb,context_sources jsonb NOT NULL DEFAULT '[]',
 usage_event_id uuid REFERENCES ai_usage_events(id),error text,completed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_run_steps (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,sequence integer NOT NULL,kind text NOT NULL,tool_name text,
 input jsonb NOT NULL DEFAULT '{}',output jsonb,provenance jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,sequence)
);
CREATE TABLE ai_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 run_id uuid NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,thread_id uuid REFERENCES agent_threads(id) ON DELETE SET NULL,
 parent_artifact_id uuid REFERENCES ai_artifacts(id) ON DELETE SET NULL,created_by uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL,title text NOT NULL,version integer NOT NULL DEFAULT 1,content jsonb NOT NULL,
 claim_provenance jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE artifact_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 from_artifact_id uuid NOT NULL REFERENCES ai_artifacts(id) ON DELETE CASCADE,
 to_artifact_id uuid NOT NULL REFERENCES ai_artifacts(id) ON DELETE CASCADE,relation text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(from_artifact_id,to_artifact_id,relation)
);
CREATE INDEX ai_runs_org_created_idx ON ai_runs(org_id,created_at);
CREATE INDEX ai_artifacts_org_thread_idx ON ai_artifacts(org_id,thread_id,created_at);
ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;ALTER TABLE ai_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_artifacts ENABLE ROW LEVEL SECURITY;ALTER TABLE artifact_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_runs_member_read ON ai_runs FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY ai_runs_user_insert ON ai_runs FOR INSERT TO vantage_app WITH CHECK(is_org_member(org_id) AND user_id=current_app_user_id());
CREATE POLICY ai_runs_user_update ON ai_runs FOR UPDATE TO vantage_app USING(org_id=current_app_org_id() AND user_id=current_app_user_id()) WITH CHECK(org_id=current_app_org_id() AND user_id=current_app_user_id());
CREATE POLICY ai_steps_member ON ai_run_steps FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY ai_steps_user_insert ON ai_run_steps FOR INSERT TO vantage_app WITH CHECK(is_org_member(org_id) AND EXISTS(SELECT 1 FROM ai_runs r WHERE r.id=run_id AND r.org_id=org_id AND r.user_id=current_app_user_id()));
CREATE POLICY ai_artifacts_member ON ai_artifacts FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY ai_artifacts_user_insert ON ai_artifacts FOR INSERT TO vantage_app WITH CHECK(is_org_member(org_id) AND created_by=current_app_user_id());
CREATE POLICY artifact_links_member ON artifact_links FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY artifact_links_user_insert ON artifact_links FOR INSERT TO vantage_app WITH CHECK(is_org_member(org_id) AND EXISTS(SELECT 1 FROM ai_artifacts a WHERE a.id=from_artifact_id AND a.org_id=org_id AND a.created_by=current_app_user_id()));
GRANT SELECT,INSERT,UPDATE,DELETE ON ai_runs,ai_run_steps,ai_artifacts,artifact_links TO vantage_app,vantage_worker;
