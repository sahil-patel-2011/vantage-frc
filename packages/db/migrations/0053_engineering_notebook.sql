-- Engineering / build notebook: the team's dated design-decision journal,
-- tagged by subsystem and build phase. Doubles as Impact-award evidence.

CREATE TABLE notebook_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  entry_date date NOT NULL,
  phase text NOT NULL DEFAULT 'design'
    CHECK (phase IN ('brainstorm', 'design', 'prototype', 'build', 'test', 'iterate', 'competition', 'reflection')),
  subsystem text NOT NULL DEFAULT '',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  author_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notebook_entries_org_season_idx ON notebook_entries(org_id, season_year, entry_date DESC);
CREATE INDEX notebook_entries_org_subsystem_idx ON notebook_entries(org_id, subsystem);

ALTER TABLE notebook_entries ENABLE ROW LEVEL SECURITY;

-- The whole team writes the notebook together; edits are open to members, and
-- destructive deletes are limited to the entry's author or an owner/admin.
CREATE POLICY notebook_entries_read ON notebook_entries FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY notebook_entries_insert ON notebook_entries FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND author_user_id = current_app_user_id());
CREATE POLICY notebook_entries_update ON notebook_entries FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY notebook_entries_delete ON notebook_entries FOR DELETE TO vantage_app USING (author_user_id = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON notebook_entries TO vantage_app, vantage_worker;
