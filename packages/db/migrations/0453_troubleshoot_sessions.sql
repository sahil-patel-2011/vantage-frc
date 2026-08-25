-- Get-unstuck: troubleshooting sessions as team memory.
--
-- Community research (docs/COMMUNITY_DEMAND_RND.md) rates control-system get-unstuck help a constant
-- blocker AND finds knowledge transfer ("our only CAD person graduated and nobody taught me") the
-- loudest learning demand. Both are served by the same row: a student's walk through the curated
-- symptom tree is stored with the path they took, so the NEXT student who hits the same symptom is
-- shown "your team hit this in week 3 — here is what you did" before any AI is involved.
--
-- `path` holds the StoredPath shape from apps/web/lib/troubleshoot/symptom-tree.ts: the ordered
-- checks, what was observed, what each observation ruled out, the fix reached, and the cited doc
-- URLs. It is a record of curated tree ids and labels — never model-generated advice.
--
-- Org-scoped RLS following packages/db/migrations/0038_community_impact.sql: members read the whole
-- team's history (that is the knowledge-transfer loop), the author owns their own row, and
-- owners/admins can curate.

CREATE TABLE IF NOT EXISTS troubleshoot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Symptom id from the curated tree (e.g. 'ds-no-comms'). Not free text.
  symptom text NOT NULL,
  -- Optional free-text the student typed before picking a symptom, kept so the
  -- offline matcher can be improved from real phrasing.
  described text,
  path jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT troubleshoot_sessions_symptom_len CHECK (char_length(btrim(symptom)) BETWEEN 1 AND 120),
  CONSTRAINT troubleshoot_sessions_described_len CHECK (described IS NULL OR char_length(described) <= 2000),
  CONSTRAINT troubleshoot_sessions_resolution_len CHECK (resolution IS NULL OR char_length(resolution) <= 4000),
  CONSTRAINT troubleshoot_sessions_path_object CHECK (jsonb_typeof(path) = 'object')
);

-- The two reads the product makes: "this team's history for this symptom" and "recent sessions".
CREATE INDEX IF NOT EXISTS troubleshoot_sessions_org_symptom_idx
  ON troubleshoot_sessions (org_id, symptom, created_at DESC);
CREATE INDEX IF NOT EXISTS troubleshoot_sessions_org_created_idx
  ON troubleshoot_sessions (org_id, created_at DESC);

ALTER TABLE troubleshoot_sessions ENABLE ROW LEVEL SECURITY;

-- Any member reads the whole team's troubleshooting history. This is the point of the table.
DROP POLICY IF EXISTS troubleshoot_sessions_member_read ON troubleshoot_sessions;
CREATE POLICY troubleshoot_sessions_member_read ON troubleshoot_sessions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- A member records their own walk.
DROP POLICY IF EXISTS troubleshoot_sessions_member_insert ON troubleshoot_sessions;
CREATE POLICY troubleshoot_sessions_member_insert ON troubleshoot_sessions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

-- The author updates their own session (mark resolved, add the resolution note).
DROP POLICY IF EXISTS troubleshoot_sessions_author_update ON troubleshoot_sessions;
CREATE POLICY troubleshoot_sessions_author_update ON troubleshoot_sessions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

-- Owners/admins curate team memory: correct a wrong resolution, delete a duplicate.
DROP POLICY IF EXISTS troubleshoot_sessions_admin_manage ON troubleshoot_sessions;
CREATE POLICY troubleshoot_sessions_admin_manage ON troubleshoot_sessions FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON troubleshoot_sessions TO vantage_app, vantage_worker;
