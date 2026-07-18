-- Robot bring-up / commissioning checklist. The first-power-on procedure for a
-- newly-assembled robot (distinct from competition inspection). One row per
-- checklist item per season; items are seeded from a standard template and
-- checked off pass/fail/na.

CREATE TABLE bringup_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('mechanical', 'electrical', 'software', 'validation')),
  label text NOT NULL,
  result text NOT NULL DEFAULT 'pending' CHECK (result IN ('pending', 'pass', 'fail', 'na')),
  note text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bringup_items_org_season_idx ON bringup_items(org_id, season_year, sort_order);

ALTER TABLE bringup_items ENABLE ROW LEVEL SECURITY;

-- The whole team runs bring-up together; deletes limited to author or admin.
CREATE POLICY bringup_items_read ON bringup_items FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY bringup_items_insert ON bringup_items FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY bringup_items_update ON bringup_items FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY bringup_items_delete ON bringup_items FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON bringup_items TO vantage_app, vantage_worker;
