DO $$ BEGIN CREATE ROLE vantage_pairing NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO vantage_pairing;
CREATE TABLE cad_relay_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,machine_name text NOT NULL,
 platform text NOT NULL CHECK(platform IN ('onshape','fusion360')),token_hash text UNIQUE NOT NULL,scopes text[] NOT NULL DEFAULT '{}',
 cli_version text,status text NOT NULL DEFAULT 'paired',last_seen_at timestamptz,revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cad_relay_devices_org_user_idx ON cad_relay_devices(org_id,user_id);
CREATE TABLE cad_pairing_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_code_hash text UNIQUE NOT NULL,poll_token_hash text UNIQUE NOT NULL,
 machine_name text NOT NULL,cli_version text NOT NULL,requested_platform text,
 approved_org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,approved_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
 device_id uuid REFERENCES cad_relay_devices(id) ON DELETE SET NULL,encrypted_device_token text,expires_at timestamptz NOT NULL,
 approved_at timestamptz,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cad_relay_devices ENABLE ROW LEVEL SECURITY;ALTER TABLE cad_pairing_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY cad_devices_owner_read ON cad_relay_devices FOR SELECT TO vantage_app USING(user_id=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
CREATE POLICY cad_devices_owner_revoke ON cad_relay_devices FOR UPDATE TO vantage_app USING(user_id=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[])) WITH CHECK(user_id=current_app_user_id() OR has_org_role(org_id,ARRAY['owner','admin']::org_role[]));
CREATE POLICY cad_pairing_approve_read ON cad_pairing_codes FOR SELECT TO vantage_app USING(current_app_user_id() IS NOT NULL);
CREATE POLICY cad_pairing_approve_update ON cad_pairing_codes FOR UPDATE TO vantage_app USING(approved_user_id IS NULL AND consumed_at IS NULL AND expires_at>now()) WITH CHECK(approved_user_id=current_app_user_id() AND is_org_member(approved_org_id));
CREATE POLICY cad_pairing_service_insert ON cad_pairing_codes FOR INSERT TO vantage_pairing WITH CHECK(true);
CREATE POLICY cad_pairing_service_read ON cad_pairing_codes FOR SELECT TO vantage_pairing USING(true);
CREATE POLICY cad_pairing_service_update ON cad_pairing_codes FOR UPDATE TO vantage_pairing USING(true) WITH CHECK(true);
CREATE POLICY cad_devices_pairing_insert ON cad_relay_devices FOR INSERT TO vantage_pairing WITH CHECK(true);
CREATE POLICY cad_devices_pairing_update ON cad_relay_devices FOR UPDATE TO vantage_pairing USING(true) WITH CHECK(true);
GRANT SELECT,UPDATE ON cad_relay_devices,cad_pairing_codes TO vantage_app;
GRANT SELECT,INSERT,UPDATE ON cad_pairing_codes,cad_relay_devices TO vantage_pairing;
