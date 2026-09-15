-- Persistent Research lookup notes: one shared note per looked-up team.
-- Members read and write through RLS. Never use vantage_worker from product code.

CREATE TABLE intel_lookup_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, team_key)
);

CREATE INDEX intel_lookup_notes_org_team_idx
  ON intel_lookup_notes (org_id, team_key);

ALTER TABLE intel_lookup_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY intel_lookup_notes_member_read ON intel_lookup_notes
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY intel_lookup_notes_member_insert ON intel_lookup_notes
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());

CREATE POLICY intel_lookup_notes_member_update ON intel_lookup_notes
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());

CREATE POLICY intel_lookup_notes_member_delete ON intel_lookup_notes
  FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON intel_lookup_notes TO vantage_app, vantage_worker;
