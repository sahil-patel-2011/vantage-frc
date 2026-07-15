ALTER TABLE platform_connectors ADD COLUMN app_id text;
ALTER TABLE platform_connectors ADD COLUMN bridge_url text;
ALTER TABLE platform_connectors ADD COLUMN feature_flag_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE platform_connectors ADD COLUMN approval_reference text;
ALTER TABLE platform_connectors ADD COLUMN approval_date date;
ALTER TABLE platform_connectors ADD COLUMN approval_acknowledged boolean NOT NULL DEFAULT false;
ALTER TABLE platform_connectors ADD COLUMN health_verified_at timestamptz;
ALTER TABLE platform_connectors ADD COLUMN daily_quota integer NOT NULL DEFAULT 0;
ALTER TABLE platform_connectors ADD CONSTRAINT base44_enablement_requirements_ck CHECK(kind<>'base44' OR enabled=false OR
 (feature_flag_enabled AND app_id IS NOT NULL AND bridge_url IS NOT NULL AND credential_ciphertext IS NOT NULL
  AND approval_acknowledged AND approval_reference IS NOT NULL AND approval_date IS NOT NULL AND health_verified_at IS NOT NULL)) NOT VALID;
CREATE TABLE base44_usage_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),connector_id uuid NOT NULL REFERENCES platform_connectors(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id),
 request_id text UNIQUE NOT NULL,feature text NOT NULL,model_mapping text NOT NULL,status text NOT NULL,
 returned_usage jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX base44_usage_connector_created_idx ON base44_usage_events(connector_id,created_at);
CREATE TABLE base44_bridge_nonces (
 nonce_hash text PRIMARY KEY,connector_id uuid NOT NULL REFERENCES platform_connectors(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id),
 expires_at timestamptz NOT NULL,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE base44_usage_events ENABLE ROW LEVEL SECURITY;ALTER TABLE base44_bridge_nonces ENABLE ROW LEVEL SECURITY;
CREATE POLICY base44_usage_org_admin ON base44_usage_events FOR SELECT TO vantage_app USING(has_org_role(org_id,ARRAY['owner','admin']::org_role[]) OR is_platform_admin());
CREATE POLICY base44_usage_platform_write ON base44_usage_events FOR INSERT TO vantage_app WITH CHECK(is_platform_admin());
CREATE POLICY base44_nonces_platform ON base44_bridge_nonces FOR ALL TO vantage_app USING(is_platform_admin()) WITH CHECK(is_platform_admin());
GRANT SELECT,INSERT,UPDATE,DELETE ON base44_usage_events,base44_bridge_nonces TO vantage_app,vantage_worker;
