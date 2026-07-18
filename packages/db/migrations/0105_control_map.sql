-- Driver control map: the drive team's button-map reference. One row per input
-- binding (controller + input -> command) so the mapping is structured, shared,
-- and printable for the driver station.

CREATE TABLE control_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  controller text NOT NULL DEFAULT 'driver' CHECK (controller IN ('driver', 'operator', 'other')),
  input_label text NOT NULL,
  command text NOT NULL,
  mode text NOT NULL DEFAULT 'teleop' CHECK (mode IN ('teleop', 'test', 'both')),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX control_bindings_org_season_idx ON control_bindings(org_id, season_year, controller);

ALTER TABLE control_bindings ENABLE ROW LEVEL SECURITY;

-- The whole team maintains the control map; deletes limited to author or admin.
CREATE POLICY control_bindings_read ON control_bindings FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY control_bindings_insert ON control_bindings FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY control_bindings_update ON control_bindings FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY control_bindings_delete ON control_bindings FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON control_bindings TO vantage_app, vantage_worker;
