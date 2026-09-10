-- Paired AI relay nodes (Raspberry Pi fleet). Mirrors storage_nodes: human pairing
-- code, sha256 device token, vantage_pairing pool, liveness FROM last_heartbeat_at.

CREATE TABLE relay_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  paired_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text UNIQUE NOT NULL,
  base_url text,
  node_version text,
  lan_addresses text[] NOT NULL DEFAULT '{}',
  last_heartbeat_at timestamptz,
  queue_depth integer CHECK (queue_depth IS NULL OR queue_depth >= 0),
  tokens_per_second numeric,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX relay_nodes_org_idx ON relay_nodes(org_id);

CREATE TABLE relay_node_capabilities (
  node_id uuid NOT NULL REFERENCES relay_nodes(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('chat', 'agent', 'video')),
  instances integer NOT NULL DEFAULT 1 CHECK (instances >= 1 AND instances <= 16),
  PRIMARY KEY (node_id, role)
);

CREATE TABLE relay_node_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_code_hash text UNIQUE NOT NULL,
  poll_token_hash text UNIQUE NOT NULL,
  machine_name text NOT NULL,
  node_version text NOT NULL,
  approved_org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  approved_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  node_id uuid REFERENCES relay_nodes(id) ON DELETE SET NULL,
  encrypted_node_token text,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE relay_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_node_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_node_pairing_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY relay_nodes_member_read ON relay_nodes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY relay_nodes_admin_insert ON relay_nodes FOR INSERT TO vantage_app
  WITH CHECK (
    paired_by = current_app_user_id()
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
  );
CREATE POLICY relay_nodes_admin_update ON relay_nodes FOR UPDATE TO vantage_app
  USING (paired_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (paired_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY relay_caps_member_read ON relay_node_capabilities FOR SELECT TO vantage_app
  USING (EXISTS (SELECT 1 FROM relay_nodes n WHERE n.id = node_id AND is_org_member(n.org_id)));
CREATE POLICY relay_caps_admin_write ON relay_node_capabilities FOR ALL TO vantage_app
  USING (EXISTS (
    SELECT 1 FROM relay_nodes n
    WHERE n.id = node_id AND (n.paired_by = current_app_user_id() OR has_org_role(n.org_id, ARRAY['owner','admin']::org_role[]))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM relay_nodes n
    WHERE n.id = node_id AND (n.paired_by = current_app_user_id() OR has_org_role(n.org_id, ARRAY['owner','admin']::org_role[]))
  ));

CREATE POLICY relay_pairing_approve_read ON relay_node_pairing_codes FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY relay_pairing_approve_update ON relay_node_pairing_codes FOR UPDATE TO vantage_app
  USING (approved_user_id IS NULL AND consumed_at IS NULL AND expires_at > now())
  WITH CHECK (approved_user_id = current_app_user_id() AND is_org_member(approved_org_id));

CREATE POLICY relay_pairing_service_insert ON relay_node_pairing_codes FOR INSERT TO vantage_pairing WITH CHECK (true);
CREATE POLICY relay_pairing_service_read ON relay_node_pairing_codes FOR SELECT TO vantage_pairing USING (true);
CREATE POLICY relay_pairing_service_update ON relay_node_pairing_codes FOR UPDATE TO vantage_pairing USING (true) WITH CHECK (true);
CREATE POLICY relay_nodes_pairing_insert ON relay_nodes FOR INSERT TO vantage_pairing WITH CHECK (true);
CREATE POLICY relay_nodes_pairing_update ON relay_nodes FOR UPDATE TO vantage_pairing USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE ON relay_nodes TO vantage_app;
GRANT SELECT ON relay_nodes TO vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON relay_node_capabilities TO vantage_app, vantage_worker;
GRANT SELECT, UPDATE ON relay_node_pairing_codes TO vantage_app;
GRANT SELECT, INSERT, UPDATE ON relay_node_pairing_codes, relay_nodes TO vantage_pairing;

CREATE OR REPLACE FUNCTION relay_node_heartbeat(
  device_hash text,
  node_version_in text,
  lan_addresses_in text[],
  queue_depth_in integer,
  tokens_per_second_in numeric
)
RETURNS TABLE(out_node_id uuid, out_org_id uuid, out_name text, out_base_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n relay_nodes%ROWTYPE;
BEGIN
  SELECT * INTO n FROM relay_nodes WHERE token_hash = device_hash AND revoked_at IS NULL FOR UPDATE;
  IF n.id IS NULL THEN RAISE EXCEPTION 'Relay node token is invalid or revoked'; END IF;
  UPDATE relay_nodes SET
    last_heartbeat_at = now(),
    updated_at = now(),
    node_version = COALESCE(node_version_in, node_version),
    lan_addresses = COALESCE(lan_addresses_in, lan_addresses),
    queue_depth = COALESCE(queue_depth_in, queue_depth),
    tokens_per_second = COALESCE(tokens_per_second_in, tokens_per_second)
  WHERE id = n.id;
  RETURN QUERY SELECT n.id, n.org_id, n.name, n.base_url;
END $$;

REVOKE ALL ON FUNCTION relay_node_heartbeat(text, text, text[], integer, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION relay_node_heartbeat(text, text, text[], integer, numeric) TO vantage_pairing;
