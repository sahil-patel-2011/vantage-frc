-- Pre-match checklist: one-tap timed checklist per match (bumper, battery, tether, code).
-- Each run tracks when it started and each item's checked-at time so pit crews can see how
-- fast the team gets ready before a match. Free-text match/event labels — not FK'd to
-- matches_ref/events_ref so a checklist can be started for scrimmages or matches TBA hasn't
-- synced yet.
--
-- Neon may already have a legacy ORM shape (note/started_by + separate items tables) without
-- this migration recorded. Empty legacy tables are replaced so Soft-UI match-checklist matches
-- the jsonb items column used by compute-match-checklist.

DROP TABLE IF EXISTS match_checklist_run_items CASCADE;
DROP TABLE IF EXISTS match_checklist_items CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'match_checklist_runs'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'match_checklist_runs'
      AND column_name = 'items'
  ) THEN
    DROP TABLE match_checklist_runs CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS match_checklist_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_label text NOT NULL,
  event_key text,
  team_number integer,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  items jsonb NOT NULL DEFAULT '[]',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_checklist_runs_org_started_idx
  ON match_checklist_runs(org_id, started_at DESC);

ALTER TABLE match_checklist_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS match_checklist_runs_member_read ON match_checklist_runs;
DROP POLICY IF EXISTS match_checklist_runs_read ON match_checklist_runs;
CREATE POLICY match_checklist_runs_member_read ON match_checklist_runs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
DROP POLICY IF EXISTS match_checklist_runs_member_insert ON match_checklist_runs;
DROP POLICY IF EXISTS match_checklist_runs_insert ON match_checklist_runs;
CREATE POLICY match_checklist_runs_member_insert ON match_checklist_runs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
DROP POLICY IF EXISTS match_checklist_runs_member_update ON match_checklist_runs;
DROP POLICY IF EXISTS match_checklist_runs_update ON match_checklist_runs;
CREATE POLICY match_checklist_runs_member_update ON match_checklist_runs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
DROP POLICY IF EXISTS match_checklist_runs_member_delete ON match_checklist_runs;
DROP POLICY IF EXISTS match_checklist_runs_delete ON match_checklist_runs;
CREATE POLICY match_checklist_runs_member_delete ON match_checklist_runs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON match_checklist_runs TO vantage_app, vantage_worker;
