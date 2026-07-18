-- Offline-friendly scout QR handoff short codes (CAD-style ambiguous alphabet).

CREATE TABLE IF NOT EXISTS scout_handoff_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_code_hash text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  payload jsonb NOT NULL,
  record_count integer NOT NULL CHECK (record_count > 0 AND record_count <= 100),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_code_hash)
);

CREATE INDEX IF NOT EXISTS scout_handoff_codes_org_created_idx
  ON scout_handoff_codes (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scout_handoff_codes_expires_idx
  ON scout_handoff_codes (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE scout_handoff_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scout_handoff_member_read ON scout_handoff_codes;
CREATE POLICY scout_handoff_member_read ON scout_handoff_codes
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

DROP POLICY IF EXISTS scout_handoff_member_insert ON scout_handoff_codes;
CREATE POLICY scout_handoff_member_insert ON scout_handoff_codes
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

DROP POLICY IF EXISTS scout_handoff_member_update ON scout_handoff_codes;
CREATE POLICY scout_handoff_member_update ON scout_handoff_codes
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND consumed_at IS NULL AND expires_at > now())
  WITH CHECK (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE ON scout_handoff_codes TO vantage_app, vantage_worker;
