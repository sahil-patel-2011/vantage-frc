-- Import changes from Excel back into Vantage (docs/MICROSOFT_EXCEL.md,
-- "Importing changes from Excel").
--
-- An owner/admin previews what differs between the team's synced workbook and
-- Postgres, then confirms. Only human-owned columns are applied (pick-list rank,
-- bucket, notes; scouting answers and confidence), and only on rows whose
-- updated_at in the workbook still matches Postgres. The writes themselves go
-- through the existing tables and their RLS policies; this table records each
-- confirmed import, mirroring workbook_sync_runs (0671).
--
-- It stores counts and a small summary (row ids and column names that changed,
-- per sheet) — never the cell contents themselves.

CREATE TABLE workbook_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- applied: at least one change written; nothing_applied: the import ran but every
  -- confirmed change was a conflict or no longer matched; failed: the workbook could
  -- not be read (the error says why).
  status text NOT NULL CHECK (status IN ('applied', 'nothing_applied', 'failed')),
  -- Cell changes written.
  applied integer NOT NULL DEFAULT 0 CHECK (applied >= 0),
  -- Rows left alone because Vantage changed them after the workbook was written.
  conflicts integer NOT NULL DEFAULT 0 CHECK (conflicts >= 0),
  -- Everything else that differed but was not applied: unconfirmed or stale changes,
  -- invalid values, read-only columns, unmatched rows, rows without an id, duplicate ids.
  skipped integer NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  -- {"confirmed": 4, "stale": 0, "tables": {"PickList": {"applied": 3, "rows": [...ids],
  --   "fields": ["rank", "notes"], "conflicts": 1, ...}, ...}}
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(summary) <= 65536),
  error text CHECK (error IS NULL OR length(error) <= 2000),
  started_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX workbook_import_runs_org_started_idx ON workbook_import_runs (org_id, started_at DESC);

ALTER TABLE workbook_import_runs ENABLE ROW LEVEL SECURITY;

-- Import history is for the people who can run an import: owners and admins.
CREATE POLICY workbook_import_runs_admin_read ON workbook_import_runs FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY workbook_import_runs_admin_insert ON workbook_import_runs FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND (started_by IS NULL OR started_by = current_app_user_id())
  );
CREATE POLICY workbook_import_runs_admin_update ON workbook_import_runs FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON workbook_import_runs TO vantage_app, vantage_worker;
