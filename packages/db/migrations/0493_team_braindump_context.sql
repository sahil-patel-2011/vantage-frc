-- Personal onboarding braindump + shareable team facts (no PII in team notes).
-- Team injection stays opt-in via team_memory_settings.enabled.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS team_braindump text,
  ADD COLUMN IF NOT EXISTS share_team_braindump boolean NOT NULL DEFAULT false;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_team_braindump_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_team_braindump_check
  CHECK (team_braindump IS NULL OR char_length(team_braindump) <= 4000);

CREATE TABLE IF NOT EXISTS org_team_context_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  crew_role text,
  content text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CONSTRAINT org_team_context_notes_content_check CHECK (char_length(btrim(content)) BETWEEN 12 AND 8000),
  CONSTRAINT org_team_context_notes_crew_check CHECK (
    crew_role IS NULL OR crew_role IN (
      'scout','driver','operator','mechanical','electrical','programming','cad','pit','business','other'
    )
  )
);

CREATE INDEX IF NOT EXISTS org_team_context_notes_org_idx
  ON org_team_context_notes (org_id, created_at DESC)
  WHERE disabled_at IS NULL;

ALTER TABLE org_team_context_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_team_context_notes_member_read ON org_team_context_notes;
CREATE POLICY org_team_context_notes_member_read ON org_team_context_notes
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

DROP POLICY IF EXISTS org_team_context_notes_member_insert ON org_team_context_notes;
CREATE POLICY org_team_context_notes_member_insert ON org_team_context_notes
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

DROP POLICY IF EXISTS org_team_context_notes_member_update ON org_team_context_notes;
CREATE POLICY org_team_context_notes_member_update ON org_team_context_notes
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE ON org_team_context_notes TO vantage_app, vantage_worker;
