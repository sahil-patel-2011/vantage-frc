-- Scout form studio: server-side drafts (autosave / resume on any device) and reusable
-- templates ("start from last season", "save as template"). Both are org-scoped and
-- coach-written; every member may read so a scout can preview what is coming.
--
-- scout_form_drafts    - ONE working draft per (org, season, kind). The builder autosaves
--                        into it and resumes from it; publishing still goes through
--                        scout_schemas (versioned, append-only) exactly as before.
-- scout_form_templates - named definitions a team keeps across seasons. Built-in starters
--                        come from packages/game-year at request time and are never stored.

CREATE TABLE scout_form_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_kind scout_schema_type NOT NULL,
  season_year integer NOT NULL CHECK (season_year BETWEEN 1992 AND 2100),
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 120),
  definition jsonb NOT NULL DEFAULT '{"title":"","fields":[]}'::jsonb,
  -- The published version this draft was loaded from, so "draft changes" can be
  -- diffed against the right base. Deleting that version must not delete the draft.
  base_schema_id uuid REFERENCES scout_schemas(id) ON DELETE SET NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, form_kind)
);

CREATE INDEX scout_form_drafts_org_idx ON scout_form_drafts(org_id, season_year);

ALTER TABLE scout_form_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_form_drafts_member_read ON scout_form_drafts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_form_drafts_coach_insert ON scout_form_drafts FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND updated_by = current_app_user_id()
  );
CREATE POLICY scout_form_drafts_coach_update ON scout_form_drafts FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND updated_by = current_app_user_id()
  );
CREATE POLICY scout_form_drafts_coach_delete ON scout_form_drafts FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_form_drafts TO vantage_app, vantage_worker;

CREATE TABLE scout_form_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  form_kind scout_schema_type NOT NULL,
  source_year integer CHECK (source_year IS NULL OR source_year BETWEEN 1992 AND 2100),
  definition jsonb NOT NULL,
  field_count integer NOT NULL DEFAULT 0 CHECK (field_count >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Same-name templates of the same kind are confusing in a "Start from" list.
CREATE UNIQUE INDEX scout_form_templates_org_kind_name_uq
  ON scout_form_templates(org_id, form_kind, lower(name));

ALTER TABLE scout_form_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_form_templates_member_read ON scout_form_templates FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_form_templates_coach_insert ON scout_form_templates FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY scout_form_templates_coach_update ON scout_form_templates FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_form_templates_coach_delete ON scout_form_templates FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_form_templates TO vantage_app, vantage_worker;
