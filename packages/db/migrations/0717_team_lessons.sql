-- Team lessons: step-by-step learning modules a team writes itself (or uploads as a PDF), each
-- ending in practice questions that Vantage checks on the server.
--
-- Complements the code-defined guided tracks (apps/web/lib/guided) and the Code & CAD hub
-- (/learn). Content lives in team_lessons.body as structured JSON — steps and practice
-- questions — validated by apps/web/lib/team-lessons/body.ts before it is written. Answers are
-- stored here and stripped by the API for anyone who cannot edit the lesson; grading happens
-- only on the server.
--
-- WHO CAN DO WHAT (mirrored in apps/web/lib/team-lessons/permissions.ts for plain messages):
--   * Every member reads PUBLISHED lessons. The person who created a lesson also reads it while
--     it is a draft or archived; owners and admins read every lesson.
--   * Owners and admins create, edit, publish, unpublish, archive and delete any lesson.
--   * Team members (role scout) create lessons and edit THEIR OWN DRAFTS. Publishing is the one
--     status change they may make to their own draft; once published, only an owner or admin
--     changes it (moving it back to draft hands it back to its author).
--   * A creator may delete their own draft.
--   * View only members read published lessons and take the practice; 0715's guards refuse any
--     other write.
--
-- AUTOSAVE HISTORY: team_lesson_revisions keeps a copy of the lesson as it was before an
-- autosave, at most one per lesson per 5 minutes, plus one on every publish and before every
-- restore. The API prunes it to the newest 50 per lesson in the same transaction.
--
-- PRACTICE: team_lesson_attempts is a person's own practice record (like cad_learn_submissions):
-- they insert and read their own; owners and admins read every attempt in their team. It is
-- exempt from 0715's View only guards so a viewer can practise.
--
-- Optimistic concurrency: team_lessons.version goes up by one on every write. Autosave sends
-- the version it last saw and gets 409 with the current content when someone else saved first.

CREATE TABLE IF NOT EXISTS team_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled lesson'
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 600),
  audience text NOT NULL DEFAULT '' CHECK (char_length(audience) <= 120),
  minutes integer CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 600),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  source text NOT NULL DEFAULT 'editor' CHECK (source IN ('editor', 'pdf')),
  body jsonb NOT NULL DEFAULT '{"steps":[],"practice":[]}'::jsonb
    CHECK (
      jsonb_typeof(body) = 'object'
      AND jsonb_typeof(body -> 'steps') = 'array'
      AND jsonb_typeof(body -> 'practice') = 'array'
      AND jsonb_array_length(body -> 'steps') <= 40
      AND jsonb_array_length(body -> 'practice') <= 20
    ),
  -- A team-space Vantage Drive file (0641). Deleting the file leaves the lesson, without its PDF.
  pdf_file_id uuid REFERENCES drive_files(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS team_lessons_org_status_idx
  ON team_lessons (org_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS team_lessons_org_creator_idx
  ON team_lessons (org_id, created_by);
CREATE INDEX IF NOT EXISTS team_lessons_pdf_file_idx
  ON team_lessons (pdf_file_id) WHERE pdf_file_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS team_lesson_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES team_lessons(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  title text NOT NULL CHECK (char_length(title) <= 160),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object'),
  saved_by uuid NOT NULL REFERENCES users(id),
  saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_lesson_revisions_lesson_idx
  ON team_lesson_revisions (lesson_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS team_lesson_revisions_org_idx
  ON team_lesson_revisions (org_id);

CREATE TABLE IF NOT EXISTS team_lesson_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES team_lessons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  score integer NOT NULL CHECK (score >= 0),
  total integer NOT NULL CHECK (total >= 0 AND total <= 20),
  passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (score <= total)
);

CREATE INDEX IF NOT EXISTS team_lesson_attempts_user_idx
  ON team_lesson_attempts (org_id, user_id, lesson_id, created_at DESC);
CREATE INDEX IF NOT EXISTS team_lesson_attempts_lesson_idx
  ON team_lesson_attempts (lesson_id, created_at DESC);

ALTER TABLE team_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_lesson_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_lesson_attempts ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------- lessons

DROP POLICY IF EXISTS team_lessons_read ON team_lessons;
CREATE POLICY team_lessons_read ON team_lessons FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      status = 'published'
      OR created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

-- A PDF must be a TEAM file of the same team: personal Drive files are readable by their owner
-- only, so a lesson pointing at one would be a broken lesson for everyone else. The lookup runs
-- under drive_files RLS, so it also proves the author can see the file.
DROP POLICY IF EXISTS team_lessons_insert ON team_lessons;
CREATE POLICY team_lessons_insert ON team_lessons FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin', 'scout']::org_role[])
    AND created_by = current_app_user_id()
    AND (
      status = 'draft'
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
    AND (
      pdf_file_id IS NULL
      OR EXISTS (
        SELECT 1 FROM drive_files f
         WHERE f.id = team_lessons.pdf_file_id
           AND f.org_id = team_lessons.org_id
           AND f.scope = 'team'
      )
    )
  );

DROP POLICY IF EXISTS team_lessons_update ON team_lessons;
CREATE POLICY team_lessons_update ON team_lessons FOR UPDATE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR (
      has_org_role(org_id, ARRAY['scout']::org_role[])
      AND created_by = current_app_user_id()
      AND status = 'draft'
    )
  )
  WITH CHECK (
    (
      has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
      OR (
        has_org_role(org_id, ARRAY['scout']::org_role[])
        AND created_by = current_app_user_id()
        AND status IN ('draft', 'published')
      )
    )
    AND (
      pdf_file_id IS NULL
      OR EXISTS (
        SELECT 1 FROM drive_files f
         WHERE f.id = team_lessons.pdf_file_id
           AND f.org_id = team_lessons.org_id
           AND f.scope = 'team'
      )
    )
  );

DROP POLICY IF EXISTS team_lessons_delete ON team_lessons;
CREATE POLICY team_lessons_delete ON team_lessons FOR DELETE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR (
      is_org_member(org_id)
      AND created_by = current_app_user_id()
      AND status = 'draft'
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON team_lessons TO vantage_app, vantage_worker;

-- ---------------------------------------------------------------- autosave history

-- Editors only: owners and admins, and the lesson's own author. The lesson lookup runs under
-- team_lessons RLS, so a lesson the person cannot see cannot be reached through its history.
DROP POLICY IF EXISTS team_lesson_revisions_read ON team_lesson_revisions;
CREATE POLICY team_lesson_revisions_read ON team_lesson_revisions FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM team_lessons l
         WHERE l.id = team_lesson_revisions.lesson_id
           AND l.org_id = team_lesson_revisions.org_id
           AND l.created_by = current_app_user_id()
      )
    )
  );

DROP POLICY IF EXISTS team_lesson_revisions_insert ON team_lesson_revisions;
CREATE POLICY team_lesson_revisions_insert ON team_lesson_revisions FOR INSERT TO vantage_app
  WITH CHECK (
    saved_by = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM team_lessons l
       WHERE l.id = team_lesson_revisions.lesson_id
         AND l.org_id = team_lesson_revisions.org_id
    )
    AND (
      has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
      OR (
        has_org_role(org_id, ARRAY['scout']::org_role[])
        AND EXISTS (
          SELECT 1 FROM team_lessons l
           WHERE l.id = team_lesson_revisions.lesson_id
             AND l.created_by = current_app_user_id()
        )
      )
    )
  );

-- Pruning to the newest 50 runs as the person saving, so the same people may delete.
DROP POLICY IF EXISTS team_lesson_revisions_delete ON team_lesson_revisions;
CREATE POLICY team_lesson_revisions_delete ON team_lesson_revisions FOR DELETE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR (
      has_org_role(org_id, ARRAY['scout']::org_role[])
      AND EXISTS (
        SELECT 1 FROM team_lessons l
         WHERE l.id = team_lesson_revisions.lesson_id
           AND l.created_by = current_app_user_id()
      )
    )
  );

-- No UPDATE policy: a revision is a copy of what was there and never changes.
GRANT SELECT, INSERT, DELETE ON team_lesson_revisions TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_lesson_revisions TO vantage_worker;

-- ---------------------------------------------------------------- practice attempts

DROP POLICY IF EXISTS team_lesson_attempts_read ON team_lesson_attempts;
CREATE POLICY team_lesson_attempts_read ON team_lesson_attempts FOR SELECT TO vantage_app
  USING (
    (is_org_member(org_id) AND user_id = current_app_user_id())
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

-- Only for a lesson this person can see, in the same team.
DROP POLICY IF EXISTS team_lesson_attempts_insert ON team_lesson_attempts;
CREATE POLICY team_lesson_attempts_insert ON team_lesson_attempts FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND user_id = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM team_lessons l
       WHERE l.id = team_lesson_attempts.lesson_id
         AND l.org_id = team_lesson_attempts.org_id
    )
  );

-- No UPDATE or DELETE for request code: an attempt is a record of what was answered. Lessons
-- and people going away remove them by cascade.
GRANT SELECT, INSERT ON team_lesson_attempts TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_lesson_attempts TO vantage_worker;

-- ---------------------------------------------------------------- View only (0715)

INSERT INTO view_only_exempt_tables (table_name, reason, added_in) VALUES
  ('team_lesson_attempts', 'Own practice answers on a team lesson (self and admins read), like cad_learn_submissions.', '0717')
ON CONFLICT (table_name) DO UPDATE SET reason = EXCLUDED.reason;

SELECT install_view_only_guards();
