-- Custom scouting form builder: per-org form identities with immutable versioned
-- schemas and typed fields (dropdown, multiple choice, short/long text, number,
-- drivetrain type, robot image). Design-time versions can publish into the
-- existing runtime scout_schemas used by match/pit entry sync.

CREATE TYPE scout_form_field_type AS ENUM (
  'dropdown',
  'multiple_choice',
  'short_answer',
  'long_text',
  'number',
  'drivetrain_type',
  'robot_image'
);

CREATE TYPE scout_form_version_status AS ENUM (
  'draft',
  'published',
  'retired'
);

CREATE TABLE scout_forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  form_kind scout_schema_type NOT NULL,
  season_year integer NOT NULL,
  description text NOT NULL DEFAULT '',
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year, form_kind, slug)
);
CREATE INDEX scout_forms_org_season_idx
  ON scout_forms(org_id, season_year, form_kind);

CREATE TABLE scout_form_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_id uuid NOT NULL REFERENCES scout_forms(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status scout_form_version_status NOT NULL DEFAULT 'draft',
  title text NOT NULL,
  notes text NOT NULL DEFAULT '',
  -- Optional link to the runtime scout_schemas row created on publish.
  published_schema_id uuid REFERENCES scout_schemas(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version)
);
CREATE INDEX scout_form_versions_org_form_idx
  ON scout_form_versions(org_id, form_id, version DESC);
CREATE INDEX scout_form_versions_org_status_idx
  ON scout_form_versions(org_id, status);
-- At most one actively published schema per form.
CREATE UNIQUE INDEX scout_form_versions_one_published_uq
  ON scout_form_versions(form_id)
  WHERE status = 'published';

CREATE TABLE scout_form_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES scout_form_versions(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  label text NOT NULL,
  field_type scout_form_field_type NOT NULL,
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  -- Option labels for dropdown / multiple_choice. drivetrain_type may leave
  -- this empty and use the platform default set at render time.
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Type-specific knobs: number min/max/step, multiple_choice allow_multiple,
  -- robot_image max_bytes / content_types, etc.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  help_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, field_key)
);
CREATE INDEX scout_form_fields_version_sort_idx
  ON scout_form_fields(version_id, sort_order, field_key);
CREATE INDEX scout_form_fields_org_idx
  ON scout_form_fields(org_id);

ALTER TABLE scout_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_form_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_form_fields ENABLE ROW LEVEL SECURITY;

-- Members can read form definitions; coaches (owner/admin) author versions.
CREATE POLICY scout_forms_member_read ON scout_forms FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_forms_coach_insert ON scout_forms FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY scout_forms_coach_update ON scout_forms FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_forms_coach_delete ON scout_forms FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY scout_form_versions_member_read ON scout_form_versions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_form_versions_coach_insert ON scout_form_versions FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY scout_form_versions_coach_update ON scout_form_versions FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_form_versions_coach_delete ON scout_form_versions FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY scout_form_fields_member_read ON scout_form_fields FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_form_fields_coach_insert ON scout_form_fields FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_form_fields_coach_update ON scout_form_fields FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY scout_form_fields_coach_delete ON scout_form_fields FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_forms, scout_form_versions, scout_form_fields
  TO vantage_app, vantage_worker;
