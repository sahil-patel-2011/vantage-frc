CREATE TABLE data_source_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,source text NOT NULL,
 opaque_key_id text UNIQUE NOT NULL,encrypted_secret text NOT NULL,status text NOT NULL DEFAULT 'untested',
 last_tested_at timestamptz,last_test_status integer,disabled_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX data_source_platform_uq ON data_source_credentials(source) WHERE org_id IS NULL;
CREATE UNIQUE INDEX data_source_org_uq ON data_source_credentials(source,org_id) WHERE org_id IS NOT NULL;
CREATE INDEX data_source_credentials_source_org_idx ON data_source_credentials(source,org_id);
CREATE TABLE data_source_health (
 source text PRIMARY KEY,status text NOT NULL,requests_last_hour integer NOT NULL DEFAULT 0,rate_limit_remaining integer,
 consecutive_failures integer NOT NULL DEFAULT 0,last_success_at timestamptz,last_failure_at timestamptz,next_attempt_at timestamptz,
 key_source_opaque_id text,details jsonb NOT NULL DEFAULT '{}',updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reference_timeline (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text NOT NULL,event_key text REFERENCES events_ref(event_key) ON DELETE CASCADE,
 entity_type text NOT NULL,entity_key text NOT NULL,event_type text NOT NULL,fingerprint text UNIQUE NOT NULL,payload jsonb NOT NULL,
 source_timestamp timestamptz,observed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reference_timeline_event_observed_idx ON reference_timeline(event_key,observed_at);
CREATE TABLE source_conflicts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_key text REFERENCES events_ref(event_key) ON DELETE CASCADE,
 entity_type text NOT NULL,entity_key text NOT NULL,field text NOT NULL,official_source text NOT NULL,official_value jsonb NOT NULL,
 conflicting_source text NOT NULL,conflicting_value jsonb NOT NULL,status text NOT NULL DEFAULT 'open',
 detected_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz
);
CREATE INDEX source_conflicts_event_entity_idx ON source_conflicts(event_key,entity_key);
CREATE TABLE org_live_subscriptions (
 org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,enabled boolean NOT NULL DEFAULT true,
 fallback_credential_id uuid REFERENCES data_source_credentials(id) ON DELETE SET NULL,last_evaluated_at timestamptz,
 updated_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE org_live_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 event_key text REFERENCES events_ref(event_key),type text NOT NULL,severity text NOT NULL,title text NOT NULL,body text NOT NULL,
 dedupe_key text NOT NULL,source_refs jsonb NOT NULL DEFAULT '[]',ai_run_id uuid REFERENCES ai_runs(id) ON DELETE SET NULL,
 acknowledged_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(org_id,dedupe_key)
);
CREATE INDEX org_live_alerts_org_created_idx ON org_live_alerts(org_id,created_at);
ALTER TABLE data_source_credentials ENABLE ROW LEVEL SECURITY;ALTER TABLE org_live_subscriptions ENABLE ROW LEVEL SECURITY;ALTER TABLE org_live_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_source_health ENABLE ROW LEVEL SECURITY;ALTER TABLE reference_timeline ENABLE ROW LEVEL SECURITY;ALTER TABLE source_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_data_credentials ON data_source_credentials FOR ALL TO vantage_app USING(org_id IS NULL AND is_platform_admin()) WITH CHECK(org_id IS NULL AND is_platform_admin() AND created_by=current_app_user_id() AND updated_by=current_app_user_id());
CREATE POLICY org_data_credentials ON data_source_credentials FOR ALL TO vantage_app USING(org_id IS NOT NULL AND has_org_role(org_id,ARRAY['owner','admin']::org_role[])) WITH CHECK(org_id IS NOT NULL AND has_org_role(org_id,ARRAY['owner','admin']::org_role[]) AND created_by=current_app_user_id() AND updated_by=current_app_user_id());
CREATE POLICY data_health_read ON data_source_health FOR SELECT TO vantage_app USING(current_app_user_id() IS NOT NULL);
CREATE POLICY reference_timeline_read ON reference_timeline FOR SELECT TO vantage_app USING(current_app_user_id() IS NOT NULL);
CREATE POLICY source_conflicts_read ON source_conflicts FOR SELECT TO vantage_app USING(current_app_user_id() IS NOT NULL);
CREATE POLICY org_live_subscriptions_member ON org_live_subscriptions FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY org_live_subscriptions_admin ON org_live_subscriptions FOR ALL TO vantage_app USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[])) WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
CREATE POLICY org_live_alerts_member ON org_live_alerts FOR SELECT TO vantage_app USING(is_org_member(org_id));
CREATE POLICY org_live_alerts_admin_update ON org_live_alerts FOR UPDATE TO vantage_app USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[])) WITH CHECK(has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
GRANT SELECT,INSERT,UPDATE,DELETE ON data_source_credentials,org_live_subscriptions,org_live_alerts TO vantage_app,vantage_worker;
GRANT SELECT ON data_source_health,reference_timeline,source_conflicts TO vantage_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON data_source_health,reference_timeline,source_conflicts TO vantage_worker;
