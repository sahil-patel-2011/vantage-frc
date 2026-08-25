-- Switching kit: saved CSV column-mapping presets.
--
-- A team importing a Google Sheet re-maps the same columns every week. A preset
-- stores one reviewed header -> target mapping per org so week 2 is one click.
-- This is mapping METADATA only: no scouting rows, no roster rows, no imported
-- content lives here, and applying a preset still lands in the review step
-- rather than committing anything on its own.

CREATE TABLE import_mapping_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Which connector the preset belongs to ('scout', 'hours', ...), so the
  -- hours importer never offers a scouting sheet's mapping.
  connector text NOT NULL,
  name text NOT NULL,
  -- { "<csv header>": "<ColumnGuess target>" }. Headers absent from this object
  -- are deliberately unmapped; the importer must not guess at them.
  columns jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, connector, name)
);
CREATE INDEX import_mapping_presets_org_connector_idx
  ON import_mapping_presets(org_id, connector, name);

ALTER TABLE import_mapping_presets ENABLE ROW LEVEL SECURITY;

-- Members can read presets; owners/admins manage them, matching who may import.
CREATE POLICY import_mapping_presets_member_read ON import_mapping_presets FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY import_mapping_presets_coach_insert ON import_mapping_presets FOR INSERT TO vantage_app
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND created_by = current_app_user_id()
  );
CREATE POLICY import_mapping_presets_coach_update ON import_mapping_presets FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY import_mapping_presets_coach_delete ON import_mapping_presets FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON import_mapping_presets TO vantage_app, vantage_worker;
