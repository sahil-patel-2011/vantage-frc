-- Rookie survival roadmap: PROGRESS ONLY.
--
-- docs/COMMUNITY_DEMAND_RND.md, demand #8: "A rookie-season survival roadmap: a dated
-- kickoff-to-first-event checklist covering registration, inspection, funding, and the
-- administrative things no one tells you" — for coaches who "know nothing of the strategy,
-- the competitions, organizing".
--
-- WHY THERE IS NO CONTENT TABLE HERE
-- ---------------------------------
-- The roadmap's phases and tasks live in code (apps/web/lib/roadmap/season-roadmap.ts).
-- A seeded template table would freeze each team's copy at the moment their org was
-- created; when we learn something new about registration or inspection, only teams
-- created after the next seed would get it. Keeping the content in code means every team
-- gets the correction on deploy. So these tables hold only what is genuinely per-team:
-- which tasks a team has finished, and the kickoff date every relative window is measured
-- from. `task_id` is a free-text id from the code list — unknown ids are ignored on read,
-- never rendered, so removing a task from the code list cannot break a team's page.
--
-- Org-scoped RLS following packages/db/migrations/0038_community_impact.sql.

-- One row per (org, task). Absence means "todo" — we do not pre-seed a row per task.
CREATE TABLE IF NOT EXISTS season_roadmap_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Task id from the code roadmap (e.g. 'register-team'). Not a foreign key by design.
  task_id text NOT NULL,
  status text NOT NULL DEFAULT 'todo',
  -- Who ticked it, kept nullable so a departed member's row survives their deletion.
  completed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  -- "We paid on the 14th, confirmation in the shared drive." Team memory, not a metric.
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT season_roadmap_progress_unique UNIQUE (org_id, task_id),
  CONSTRAINT season_roadmap_progress_status CHECK (status IN ('todo', 'done', 'skipped')),
  CONSTRAINT season_roadmap_progress_task_len CHECK (char_length(btrim(task_id)) BETWEEN 1 AND 120),
  CONSTRAINT season_roadmap_progress_note_len CHECK (note IS NULL OR char_length(note) <= 2000),
  -- A finished task must say when it finished; nothing else may claim a completion time.
  CONSTRAINT season_roadmap_progress_completed_at CHECK (
    (status = 'done' AND completed_at IS NOT NULL) OR (status <> 'done' AND completed_at IS NULL)
  )
);

-- The only read the page makes: this org's progress, all of it, in one shot.
CREATE INDEX IF NOT EXISTS season_roadmap_progress_org_idx
  ON season_roadmap_progress (org_id, task_id);

ALTER TABLE season_roadmap_progress ENABLE ROW LEVEL SECURITY;

-- Every member sees where the team stands. A rookie roadmap nobody can read is useless.
DROP POLICY IF EXISTS season_roadmap_progress_member_read ON season_roadmap_progress;
CREATE POLICY season_roadmap_progress_member_read ON season_roadmap_progress FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Any member can tick a task off; this is a shared checklist, not an admin console.
DROP POLICY IF EXISTS season_roadmap_progress_member_insert ON season_roadmap_progress;
CREATE POLICY season_roadmap_progress_member_insert ON season_roadmap_progress FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));

DROP POLICY IF EXISTS season_roadmap_progress_member_update ON season_roadmap_progress;
CREATE POLICY season_roadmap_progress_member_update ON season_roadmap_progress FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

-- Only owners/admins remove history outright; members reset by setting status back to todo.
DROP POLICY IF EXISTS season_roadmap_progress_admin_delete ON season_roadmap_progress;
CREATE POLICY season_roadmap_progress_admin_delete ON season_roadmap_progress FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

-- The kickoff date every relative window in the code roadmap is measured from, plus the
-- rookie filter. FIRST publishes a new kickoff date each season and nothing in Vantage
-- knows it, so the team types it in; until they do, the page shows no dates at all rather
-- than inventing one. `rookie_only` is a stored preference because teams_ref.rookie_year
-- is often absent for a brand-new team — exactly the team this page is for.
CREATE TABLE IF NOT EXISTS season_roadmap_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  kickoff_date date,
  -- NULL means "we have not been told" — the page then falls back to teams_ref.rookie_year
  -- and, failing that, offers a toggle instead of guessing.
  rookie_only boolean,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE season_roadmap_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS season_roadmap_settings_member_read ON season_roadmap_settings;
CREATE POLICY season_roadmap_settings_member_read ON season_roadmap_settings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

DROP POLICY IF EXISTS season_roadmap_settings_member_insert ON season_roadmap_settings;
CREATE POLICY season_roadmap_settings_member_insert ON season_roadmap_settings FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));

DROP POLICY IF EXISTS season_roadmap_settings_member_update ON season_roadmap_settings;
CREATE POLICY season_roadmap_settings_member_update ON season_roadmap_settings FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

DROP POLICY IF EXISTS season_roadmap_settings_admin_delete ON season_roadmap_settings;
CREATE POLICY season_roadmap_settings_admin_delete ON season_roadmap_settings FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON season_roadmap_progress TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON season_roadmap_settings TO vantage_app, vantage_worker;
