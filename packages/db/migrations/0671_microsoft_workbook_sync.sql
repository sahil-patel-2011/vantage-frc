-- Microsoft Excel / OneDrive workbook sync.
--
-- A team connects a Microsoft account and Vantage keeps a structured workbook in
-- that account's OneDrive up to date: Teams, Matches, MatchScouting, PitScouting,
-- PickList and SyncInfo sheets. Postgres stays the single source of truth; the
-- workbook is a synced, human-readable copy (docs/MICROSOFT_EXCEL.md explains why
-- a spreadsheet is not used as the transactional store).
--
-- Two tables:
--
--   org_microsoft_connections  one row per team: the envelope-encrypted Microsoft
--                              refresh token, which account it belongs to, which
--                              workbook it writes, and the health of the last sync.
--   workbook_sync_runs         one row per sync attempt, for the settings card and
--                              for debugging a sync that went wrong.
--
-- Secret handling. The refresh token is stored with the same envelope encryption
-- as org_llm_keys / org_tool_keys (packages/billing encryptSecret: AES-256-GCM
-- ciphertext, nonce and auth tag, the data key wrapped by KMS, and the KMS key id).
--
-- Unlike org_tool_keys (0667), members may NOT read the encrypted row. There, a
-- student's own agent run has to decrypt the team's key. Here nothing a member
-- does needs the Microsoft token: connecting, syncing and disconnecting are
-- owner/admin actions. So the base table is owner/admin-only under RLS, and
-- members read the non-secret columns through the org_microsoft_connection_status
-- view, which never selects the ciphertext columns at all.

CREATE TABLE org_microsoft_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Envelope-encrypted OAuth refresh token (offline_access). Never returned by any API.
  refresh_token_ciphertext text NOT NULL,
  refresh_token_nonce text NOT NULL,
  refresh_token_auth_tag text NOT NULL,
  encrypted_dek text NOT NULL,
  kms_key_id text NOT NULL,
  -- Who the Microsoft account is, from GET /me. Not secret: the settings card shows it
  -- so the team knows whose OneDrive holds the workbook.
  account_name text,
  account_email text,
  -- The workbook this team's sync writes. Stable OneDrive driveItem id, plus the
  -- browser URL for the "Open workbook" link.
  workbook_item_id text,
  workbook_web_url text,
  workbook_name text,
  connected_by uuid REFERENCES users(id) ON DELETE SET NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  -- Plain-language reason the most recent sync failed, if it did. Cleared on success.
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  last_error_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

ALTER TABLE org_microsoft_connections ENABLE ROW LEVEL SECURITY;

-- Owner/admin only, for every command including SELECT: they are the only people
-- whose requests decrypt the token (to run a sync) or replace it (to connect).
CREATE POLICY microsoft_connections_admin_all ON org_microsoft_connections FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON org_microsoft_connections TO vantage_app, vantage_worker;

-- What any member of the team may see: connected or not, whose account, where the
-- workbook is, and how the last sync went. No ciphertext column is in this view.
--
-- The view runs with its owner's rights (not security_invoker), so it can read
-- the owner/admin-only base table; the WHERE clause is what limits a caller to
-- their own teams. security_barrier stops a caller's own predicates from being
-- pushed below that filter.
CREATE VIEW org_microsoft_connection_status WITH (security_barrier = true) AS
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
  c.last_error_at
FROM org_microsoft_connections c
WHERE is_org_member(c.org_id);

GRANT SELECT ON org_microsoft_connection_status TO vantage_app, vantage_worker;

CREATE TABLE workbook_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'partial', 'failed')),
  -- {"Teams": {"rows": 40, "ok": true}, "PickList": {"rows": 0, "ok": false, "error": "..."}}
  tables_written jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows_written integer NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  error text CHECK (error IS NULL OR length(error) <= 2000),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  started_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX workbook_sync_runs_org_started_idx ON workbook_sync_runs (org_id, started_at DESC);

ALTER TABLE workbook_sync_runs ENABLE ROW LEVEL SECURITY;

-- Sync history is operational detail for the people who run the sync.
CREATE POLICY workbook_sync_runs_admin_read ON workbook_sync_runs FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY workbook_sync_runs_admin_insert ON workbook_sync_runs FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND (started_by IS NULL OR started_by = current_app_user_id())
  );
CREATE POLICY workbook_sync_runs_admin_update ON workbook_sync_runs FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON workbook_sync_runs TO vantage_app, vantage_worker;
