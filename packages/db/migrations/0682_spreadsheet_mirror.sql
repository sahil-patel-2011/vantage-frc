-- Spreadsheet mirror: Google Sheets beside the Excel workbook (0671), both kept identical.
--
-- Postgres stays the source of truth. Google Sheets and Excel are two copies written from
-- it on every sync, so either one can be opened, shared or pulled from while the other is
-- down or throttled, and a copy that missed a sync is rebuilt in full by the next one.
--
--   org_google_sheets_connections  one Google sign-in + spreadsheet per team (owner/admin)
--   org_google_sheets_connection_status  the non-secret columns, readable by any member
--   workbook_sync_runs.target      which copy a run wrote ('excel' | 'google')
--   *.last_sync_hash               content hash of the data last written to that copy;
--                                  two copies with the same hash hold the same data
--   *.throttled_until              the provider asked Vantage to back off until then;
--                                  syncs and pulls use the other copy in the meantime
--   *.last_read_at                 last time an import pulled from that copy, so pulls
--                                  alternate instead of always hitting one provider

CREATE TABLE org_google_sheets_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  refresh_token_ciphertext text NOT NULL,
  refresh_token_nonce text NOT NULL,
  refresh_token_auth_tag text NOT NULL,
  encrypted_dek text NOT NULL,
  kms_key_id text NOT NULL,
  account_name text,
  account_email text,
  spreadsheet_id text,
  spreadsheet_url text,
  spreadsheet_name text,
  connected_by uuid REFERENCES users(id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  last_sync_hash text CHECK (last_sync_hash IS NULL OR length(last_sync_hash) <= 128),
  last_read_at timestamptz,
  throttled_until timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

ALTER TABLE org_google_sheets_connections ENABLE ROW LEVEL SECURITY;

-- The refresh token lives here, so only owners and admins touch the table itself.
CREATE POLICY google_sheets_connections_admin_all ON org_google_sheets_connections FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON org_google_sheets_connections TO vantage_app, vantage_worker;

-- Every member can see that the team has a Google copy and when it last synced — never the
-- token. security_barrier stops a caller's own predicates from being evaluated before the
-- membership check.
CREATE VIEW org_google_sheets_connection_status WITH (security_barrier = true) AS
SELECT
  c.org_id,
  c.account_name,
  c.account_email,
  c.spreadsheet_id,
  c.spreadsheet_url,
  c.spreadsheet_name,
  c.connected_by,
  c.connected_at,
  c.last_sync_at,
  c.last_sync_hash,
  c.last_read_at,
  c.throttled_until,
  c.last_error,
  c.last_error_at
FROM org_google_sheets_connections c
WHERE is_org_member(c.org_id);

GRANT SELECT ON org_google_sheets_connection_status TO vantage_app, vantage_worker;

-- The Excel side gets the same three mirror columns.
ALTER TABLE org_microsoft_connections
  ADD COLUMN IF NOT EXISTS last_sync_hash text CHECK (last_sync_hash IS NULL OR length(last_sync_hash) <= 128),
  ADD COLUMN IF NOT EXISTS last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS throttled_until timestamptz;

-- The member-readable view gains them too (appended, so existing readers are unaffected).
CREATE OR REPLACE VIEW org_microsoft_connection_status WITH (security_barrier = true) AS
SELECT
  c.org_id,
  c.account_name,
  c.account_email,
  c.workbook_item_id,
  c.workbook_web_url,
  c.workbook_name,
  c.connected_by,
  c.connected_at,
  c.last_sync_at,
  c.last_error,
  c.last_error_at,
  c.last_sync_hash,
  c.last_read_at,
  c.throttled_until
FROM org_microsoft_connections c
WHERE is_org_member(c.org_id);

-- Which copy a sync run wrote, and the hash of what it wrote.
ALTER TABLE workbook_sync_runs
  ADD COLUMN IF NOT EXISTS target text NOT NULL DEFAULT 'excel' CHECK (target IN ('excel', 'google')),
  ADD COLUMN IF NOT EXISTS content_hash text CHECK (content_hash IS NULL OR length(content_hash) <= 128);

CREATE INDEX IF NOT EXISTS workbook_sync_runs_org_target_started_idx
  ON workbook_sync_runs (org_id, target, started_at DESC);
