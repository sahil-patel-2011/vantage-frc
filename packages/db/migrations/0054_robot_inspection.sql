-- Robot Inspection & Weigh-in.
-- A per-robot pass/fail checklist mirroring the standard FRC inspection flow
-- (seeded from a year-agnostic template, extensible with custom items) plus a
-- weigh-in log so the team knows where they stand before the real inspector does.

CREATE TABLE inspection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  robot_label text NOT NULL DEFAULT 'competition',
  category text NOT NULL,
  requirement text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pass', 'fail', 'na')),
  note text NOT NULL DEFAULT '',
  is_custom boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  checked_by uuid REFERENCES users(id),
  checked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inspection_items_org_idx ON inspection_items(org_id, robot_label, category, sort_order);

CREATE TABLE robot_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  robot_label text NOT NULL DEFAULT 'competition',
  total_lbs numeric(6, 2) NOT NULL CHECK (total_lbs > 0 AND total_lbs < 1000),
  config text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  weighed_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX robot_weights_org_idx ON robot_weights(org_id, robot_label, weighed_at DESC);

CREATE TABLE inspection_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  weight_limit_lbs numeric(6, 2) NOT NULL DEFAULT 125 CHECK (weight_limit_lbs > 0 AND weight_limit_lbs < 1000),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE robot_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_settings ENABLE ROW LEVEL SECURITY;

-- Inspection is a whole-team activity: members read and update; deleting rows is
-- limited to the creator or an owner/admin. The weight limit is admin-set.
CREATE POLICY inspection_items_read ON inspection_items FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY inspection_items_insert ON inspection_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY inspection_items_update ON inspection_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY inspection_items_delete ON inspection_items FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY robot_weights_read ON robot_weights FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY robot_weights_insert ON robot_weights FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
CREATE POLICY robot_weights_delete ON robot_weights FOR DELETE TO vantage_app
  USING (recorded_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY inspection_settings_read ON inspection_settings FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY inspection_settings_write ON inspection_settings FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_items, robot_weights, inspection_settings TO vantage_app, vantage_worker;
