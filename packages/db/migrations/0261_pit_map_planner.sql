-- Pit Map Planner: lay out the pit footprint (dimensions + power budget) and place items
-- (workstations, tool stations, power drops, storage, robot cart, charging, safety) within it
-- so the team can print/share a to-scale pit map before an event.

CREATE TABLE pit_map_planner_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  footprint_width_ft numeric(6,2) NOT NULL DEFAULT 10 CHECK (footprint_width_ft > 0),
  footprint_depth_ft numeric(6,2) NOT NULL DEFAULT 10 CHECK (footprint_depth_ft > 0),
  power_capacity_amps numeric(6,2) NOT NULL DEFAULT 20 CHECK (power_capacity_amps >= 0),
  notes text,
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year)
);

ALTER TABLE pit_map_planner_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY pit_map_planner_layouts_member_read ON pit_map_planner_layouts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY pit_map_planner_layouts_member_insert ON pit_map_planner_layouts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY pit_map_planner_layouts_member_update ON pit_map_planner_layouts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY pit_map_planner_layouts_member_delete ON pit_map_planner_layouts FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON pit_map_planner_layouts TO vantage_app, vantage_worker;

CREATE TABLE pit_map_planner_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'workstation'
    CHECK (category IN ('workstation','tool_station','power_drop','storage','robot_cart','charging','safety','other')),
  x_ft numeric(6,2) NOT NULL DEFAULT 0,
  y_ft numeric(6,2) NOT NULL DEFAULT 0,
  width_ft numeric(6,2) NOT NULL DEFAULT 2 CHECK (width_ft > 0),
  depth_ft numeric(6,2) NOT NULL DEFAULT 2 CHECK (depth_ft > 0),
  power_draw_amps numeric(6,2) NOT NULL DEFAULT 0 CHECK (power_draw_amps >= 0),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pit_map_planner_items_org_season_idx ON pit_map_planner_items(org_id, season_year);

ALTER TABLE pit_map_planner_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY pit_map_planner_items_member_read ON pit_map_planner_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY pit_map_planner_items_member_insert ON pit_map_planner_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY pit_map_planner_items_member_update ON pit_map_planner_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY pit_map_planner_items_member_delete ON pit_map_planner_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON pit_map_planner_items TO vantage_app, vantage_worker;
