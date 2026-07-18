-- Morning standup digest (CD): per-day, per-org compiled brief that summarizes yesterday's
-- shop hours, task movement, open blockers, attendance, and knowledge edits into a
-- subteam-grouped narrative. Source data lives entirely in existing feature tables
-- (hour_logs, build_tasks, attendance_events/entries, knowledge_pages) — this migration
-- only adds the persisted digest snapshots and the follow-up notes members leave against them.

CREATE TABLE standup_digest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  digest_date date NOT NULL,
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 3000),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  headline text NOT NULL DEFAULT '',
  generated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT standup_digest_runs_org_date_unique UNIQUE (org_id, digest_date)
);
CREATE INDEX standup_digest_runs_org_date_idx ON standup_digest_runs(org_id, digest_date DESC);

CREATE TABLE standup_digest_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  digest_date date NOT NULL,
  subteam text NOT NULL CHECK (char_length(trim(subteam)) BETWEEN 1 AND 80),
  note text NOT NULL CHECK (char_length(trim(note)) BETWEEN 1 AND 2000),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX standup_digest_notes_org_date_idx ON standup_digest_notes(org_id, digest_date DESC, created_at DESC);

ALTER TABLE standup_digest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE standup_digest_notes ENABLE ROW LEVEL SECURITY;

-- Any org member may read and regenerate the digest; the generating member is stamped.
CREATE POLICY standup_digest_runs_member_read ON standup_digest_runs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY standup_digest_runs_member_insert ON standup_digest_runs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND (generated_by IS NULL OR generated_by = current_app_user_id()));
CREATE POLICY standup_digest_runs_member_update ON standup_digest_runs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY standup_digest_runs_member_delete ON standup_digest_runs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY standup_digest_notes_member_read ON standup_digest_notes FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY standup_digest_notes_member_insert ON standup_digest_notes FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY standup_digest_notes_member_update ON standup_digest_notes FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY standup_digest_notes_member_delete ON standup_digest_notes FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON standup_digest_runs, standup_digest_notes TO vantage_app, vantage_worker;
