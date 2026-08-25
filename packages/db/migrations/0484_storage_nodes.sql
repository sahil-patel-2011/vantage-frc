-- Self-hosted storage nodes: a team pairs an always-on computer (Raspberry Pi, shop PC)
-- that stores large binary items (media, exports) so the hosted database never maxes out.
-- Mirrors the CAD relay pairing architecture (0017/0018): human pairing code, sha256-hashed
-- device tokens, a separate vantage_pairing pool for unauthenticated pairing/heartbeat
-- traffic, and SECURITY DEFINER functions for token-authenticated node writes.
--
-- Honesty rules baked into the schema: liveness is DERIVED from last_heartbeat_at (never
-- trusted from a status column), disk numbers come only from node heartbeats (NULL until the
-- first one), and items carry a stored|missing status maintained by the node's own scrub.

DO $$ BEGIN CREATE ROLE vantage_pairing NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public TO vantage_pairing;

CREATE TABLE storage_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  paired_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- sha256 hex of the cloud-issued node token (node -> cloud auth). Plaintext lives only on the node.
  token_hash text UNIQUE NOT NULL,
  -- KMS-encrypted access key (client -> node auth). The node keeps only its hash; the cloud
  -- decrypts this for authorized org members when resolving an item.
  encrypted_access_key text,
  -- Reachable URL the team optionally sets (LAN address, Tailscale Funnel, cloudflared).
  -- NULL means the cloud has no way to reach or hand out this node — resolve says so plainly.
  base_url text,
  node_version text,
  lan_addresses text[] NOT NULL DEFAULT '{}',
  last_heartbeat_at timestamptz,
  disk_total_bytes bigint CHECK (disk_total_bytes IS NULL OR disk_total_bytes >= 0),
  disk_free_bytes bigint CHECK (disk_free_bytes IS NULL OR disk_free_bytes >= 0),
  status text NOT NULL DEFAULT 'paired' CHECK (status IN ('paired', 'online')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX storage_nodes_org_idx ON storage_nodes(org_id);

CREATE TABLE storage_node_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_code_hash text UNIQUE NOT NULL,
  poll_token_hash text UNIQUE NOT NULL,
  machine_name text NOT NULL,
  node_version text NOT NULL,
  -- KMS-encrypted access key the node generated at setup; moved onto storage_nodes at approval.
  encrypted_access_key text,
  approved_org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  approved_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  node_id uuid REFERENCES storage_nodes(id) ON DELETE SET NULL,
  encrypted_node_token text,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE storage_node_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES storage_nodes(id) ON DELETE CASCADE,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  content_type text NOT NULL DEFAULT 'application/octet-stream',
  status text NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'missing')),
  -- Last time the node itself confirmed (or denied) the bytes exist, via heartbeat scrub.
  verified_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, sha256)
);
CREATE INDEX storage_node_items_org_idx ON storage_node_items(org_id, created_at DESC);
CREATE INDEX storage_node_items_node_verify_idx ON storage_node_items(node_id, verified_at NULLS FIRST);

ALTER TABLE storage_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_node_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_node_items ENABLE ROW LEVEL SECURITY;

-- App-role policies: every member sees the team's nodes/items; only owners/admins (or the
-- person who paired the node) manage a node; members register/clean up items they created.
CREATE POLICY storage_nodes_member_read ON storage_nodes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY storage_nodes_admin_update ON storage_nodes FOR UPDATE TO vantage_app
  USING (paired_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (paired_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY storage_node_items_member_read ON storage_node_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY storage_node_items_member_insert ON storage_node_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY storage_node_items_member_update ON storage_node_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY storage_node_items_member_delete ON storage_node_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

-- Approval flow reads/updates pairing rows under the signed-in member's session.
CREATE POLICY storage_pairing_approve_read ON storage_node_pairing_codes FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY storage_pairing_approve_update ON storage_node_pairing_codes FOR UPDATE TO vantage_app
  USING (approved_user_id IS NULL AND consumed_at IS NULL AND expires_at > now())
  WITH CHECK (approved_user_id = current_app_user_id() AND is_org_member(approved_org_id));

-- Pairing-pool role: unauthenticated start/poll plus node creation at approval time.
CREATE POLICY storage_pairing_service_insert ON storage_node_pairing_codes FOR INSERT TO vantage_pairing WITH CHECK (true);
CREATE POLICY storage_pairing_service_read ON storage_node_pairing_codes FOR SELECT TO vantage_pairing USING (true);
CREATE POLICY storage_pairing_service_update ON storage_node_pairing_codes FOR UPDATE TO vantage_pairing USING (true) WITH CHECK (true);
CREATE POLICY storage_nodes_pairing_insert ON storage_nodes FOR INSERT TO vantage_pairing WITH CHECK (true);
CREATE POLICY storage_nodes_pairing_update ON storage_nodes FOR UPDATE TO vantage_pairing USING (true) WITH CHECK (true);

GRANT SELECT, UPDATE ON storage_nodes TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage_node_items TO vantage_app, vantage_worker;
GRANT SELECT ON storage_nodes TO vantage_worker;
GRANT SELECT, UPDATE ON storage_node_pairing_codes TO vantage_app;
GRANT SELECT, INSERT, UPDATE ON storage_node_pairing_codes, storage_nodes TO vantage_pairing;

-- Token-authenticated heartbeat (node -> cloud, every 60s). Updates liveness + disk stats and
-- applies the node's incremental scrub verdicts; returns up to 200 shas the node should verify
-- next (oldest-verified first) so stored|missing stays honest without a giant payload.
CREATE OR REPLACE FUNCTION storage_node_heartbeat(
  device_hash text, node_version_in text, disk_total bigint, disk_free bigint,
  lan_addresses_in text[], scrubbed boolean, verified_shas text[], missing_shas text[])
RETURNS TABLE(out_node_id uuid, out_org_id uuid, out_name text, out_base_url text, out_pending_shas text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n storage_nodes%ROWTYPE;
BEGIN
  SELECT * INTO n FROM storage_nodes WHERE token_hash = device_hash AND revoked_at IS NULL FOR UPDATE;
  IF n.id IS NULL THEN RAISE EXCEPTION 'Storage node token is invalid or revoked'; END IF;
  UPDATE storage_nodes SET
    last_heartbeat_at = now(), status = 'online', updated_at = now(),
    node_version = COALESCE(node_version_in, node_version),
    disk_total_bytes = COALESCE(disk_total, disk_total_bytes),
    disk_free_bytes = COALESCE(disk_free, disk_free_bytes),
    lan_addresses = COALESCE(lan_addresses_in, lan_addresses)
  WHERE id = n.id;
  IF scrubbed THEN
    UPDATE storage_node_items SET status = 'stored', verified_at = now()
      WHERE storage_node_items.node_id = n.id AND sha256 = ANY(COALESCE(verified_shas, '{}'));
    UPDATE storage_node_items SET status = 'missing', verified_at = now()
      WHERE storage_node_items.node_id = n.id AND sha256 = ANY(COALESCE(missing_shas, '{}'));
  END IF;
  RETURN QUERY SELECT n.id, n.org_id, n.name, n.base_url,
    ARRAY(SELECT i.sha256 FROM storage_node_items i WHERE i.node_id = n.id
          ORDER BY i.verified_at NULLS FIRST, i.created_at LIMIT 200);
END $$;

REVOKE ALL ON FUNCTION storage_node_heartbeat(text, text, bigint, bigint, text[], boolean, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storage_node_heartbeat(text, text, bigint, bigint, text[], boolean, text[], text[]) TO vantage_pairing;
