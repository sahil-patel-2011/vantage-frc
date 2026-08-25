-- Storage routing: per-org policy for WHERE new large files go (hosted database
-- vs. a paired self-hosted storage node, 0484), plus single-use upload grants so
-- the browser can push bytes STRAIGHT to the node — file bodies never transit the
-- hosted platform, whose serverless request-body limit is ~4.5 MB.
--
-- Honesty rules carried over from 0484: node liveness stays DERIVED from
-- last_heartbeat_at (no trusted status column is added here), disk numbers come
-- only from node heartbeats, and a grant row records what was AUTHORIZED — the
-- node's own scrub remains the source of truth for what is actually stored.

-- One policy row per org. Absent row = defaults (the app supplies them); a row
-- exists only after an owner/admin deliberately changes the policy.
CREATE TABLE storage_routing_policies (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  -- Files STRICTLY larger than this prefer the node. Default 4 MiB — the
  -- honest ceiling a hosted serverless upload can actually accept.
  node_threshold_bytes bigint NOT NULL DEFAULT 4194304
    CHECK (node_threshold_bytes >= 0 AND node_threshold_bytes <= 1099511627776),
  -- Content classes that ALWAYS prefer the node regardless of size.
  prefer_node_classes text[] NOT NULL DEFAULT ARRAY['video','cad','archive']
    CHECK (prefer_node_classes <@ ARRAY['video','cad','archive','photo','document','other']::text[]
           AND cardinality(prefer_node_classes) <= 6),
  -- When the node is unavailable, may a node-preferring file fall back to the
  -- hosted database (within the cloud-safe size limit)? false = refuse instead.
  cloud_fallback boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Upload grants: the cloud's record of a short-lived, single-use authorization
-- it minted for one member to upload ONE sha256 to ONE node. The row id doubles
-- as the grant nonce embedded in the HMAC-signed token the node verifies
-- offline (no cloud round trip). consumed_at is bookkeeping set at finalize;
-- the node independently enforces expiry, scope, and single use.
CREATE TABLE storage_upload_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES storage_nodes(id) ON DELETE CASCADE,
  -- Which feature's metadata row this upload feeds.
  purpose text NOT NULL CHECK (purpose IN ('library','media')),
  target_id uuid NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  max_bytes bigint NOT NULL CHECK (max_bytes >= 1),
  content_type text NOT NULL DEFAULT 'application/octet-stream'
    CHECK (char_length(content_type) BETWEEN 3 AND 255),
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX storage_upload_grants_org_idx ON storage_upload_grants(org_id, created_at DESC);
CREATE INDEX storage_upload_grants_target_idx ON storage_upload_grants(org_id, target_id);

ALTER TABLE storage_routing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_upload_grants ENABLE ROW LEVEL SECURITY;

-- Policy: every member can read it (the upload UI must explain routing to
-- everyone); only owners/admins change it.
CREATE POLICY storage_routing_policies_member_read ON storage_routing_policies
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY storage_routing_policies_admin_insert ON storage_routing_policies
  FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND updated_by = current_app_user_id());
CREATE POLICY storage_routing_policies_admin_update ON storage_routing_policies
  FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND updated_by = current_app_user_id());

-- Grants: members mint grants for their own uploads and finalize their own;
-- owners/admins can see (and clean up) all of the org's grants.
CREATE POLICY storage_upload_grants_read ON storage_upload_grants
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id)
    AND (created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])));
CREATE POLICY storage_upload_grants_insert ON storage_upload_grants
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY storage_upload_grants_update ON storage_upload_grants
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND created_by = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY storage_upload_grants_delete ON storage_upload_grants
  FOR DELETE TO vantage_app
  USING (is_org_member(org_id)
    AND (created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])));

GRANT SELECT, INSERT, UPDATE ON storage_routing_policies TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage_upload_grants TO vantage_app;
