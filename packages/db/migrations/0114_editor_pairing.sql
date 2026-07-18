-- VS Code / editor device pairing (mirrors CAD relay device-code flow).
-- Uses existing vantage_pairing role for start/poll; vantage_app for approve/revoke.

CREATE TABLE IF NOT EXISTS editor_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_name text NOT NULL,
  editor text NOT NULL DEFAULT 'vscode' CHECK (editor IN ('vscode', 'cursor', 'other')),
  token_hash text UNIQUE NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['editor.context.submit']::text[],
  extension_version text,
  status text NOT NULL DEFAULT 'paired',
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS editor_devices_org_user_idx ON editor_devices(org_id, user_id);

CREATE TABLE IF NOT EXISTS editor_pairing_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_code_hash text UNIQUE NOT NULL,
  poll_token_hash text UNIQUE NOT NULL,
  machine_name text NOT NULL,
  extension_version text NOT NULL,
  requested_editor text,
  approved_org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  approved_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES editor_devices(id) ON DELETE SET NULL,
  encrypted_device_token text,
  expires_at timestamptz NOT NULL,
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS editor_context_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES editor_devices(id) ON DELETE CASCADE,
  intent text NOT NULL,
  relative_path text,
  language_id text,
  selection_lines int,
  content_chars int NOT NULL DEFAULT 0,
  diagnostics_count int NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS editor_context_submissions_org_created_idx
  ON editor_context_submissions(org_id, created_at DESC);

ALTER TABLE editor_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE editor_pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE editor_context_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY editor_devices_owner_read ON editor_devices
  FOR SELECT TO vantage_app
  USING (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY editor_devices_owner_revoke ON editor_devices
  FOR UPDATE TO vantage_app
  USING (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY editor_pairing_approve_read ON editor_pairing_codes
  FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);

CREATE POLICY editor_pairing_approve_update ON editor_pairing_codes
  FOR UPDATE TO vantage_app
  USING (approved_user_id IS NULL AND consumed_at IS NULL AND expires_at > now())
  WITH CHECK (approved_user_id = current_app_user_id() AND is_org_member(approved_org_id));

CREATE POLICY editor_context_member_read ON editor_context_submissions
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY editor_context_member_insert ON editor_context_submissions
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

CREATE POLICY editor_pairing_service_insert ON editor_pairing_codes
  FOR INSERT TO vantage_pairing WITH CHECK (true);
CREATE POLICY editor_pairing_service_read ON editor_pairing_codes
  FOR SELECT TO vantage_pairing USING (true);
CREATE POLICY editor_pairing_service_update ON editor_pairing_codes
  FOR UPDATE TO vantage_pairing USING (true) WITH CHECK (true);
CREATE POLICY editor_devices_pairing_insert ON editor_devices
  FOR INSERT TO vantage_pairing WITH CHECK (true);
CREATE POLICY editor_devices_pairing_update ON editor_devices
  FOR UPDATE TO vantage_pairing USING (true) WITH CHECK (true);
CREATE POLICY editor_context_pairing_insert ON editor_context_submissions
  FOR INSERT TO vantage_pairing WITH CHECK (true);
CREATE POLICY editor_devices_pairing_read ON editor_devices
  FOR SELECT TO vantage_pairing USING (true);

GRANT SELECT, UPDATE ON editor_devices, editor_pairing_codes TO vantage_app;
GRANT SELECT, INSERT ON editor_context_submissions TO vantage_app;
GRANT SELECT, INSERT, UPDATE ON editor_pairing_codes, editor_devices TO vantage_pairing;
GRANT INSERT ON editor_context_submissions TO vantage_pairing;
