-- Robot weight budget: per-component weights summed against a per-season limit
-- (default 125 lb). Totals and remaining margin are computed in the app.

CREATE TABLE weight_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  subsystem text NOT NULL DEFAULT '',
  weight_lbs numeric(7, 2) NOT NULL CHECK (weight_lbs >= 0),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX weight_components_org_season_idx ON weight_components(org_id, season_year, subsystem);

CREATE TABLE weight_settings (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  limit_lbs numeric(7, 2) NOT NULL DEFAULT 125 CHECK (limit_lbs > 0),
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, season_year)
);

ALTER TABLE weight_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE weight_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY weight_components_read ON weight_components FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY weight_components_insert ON weight_components FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY weight_components_update ON weight_components FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY weight_components_delete ON weight_components FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY weight_settings_read ON weight_settings FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY weight_settings_write ON weight_settings FOR ALL TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON weight_components, weight_settings TO vantage_app, vantage_worker;
