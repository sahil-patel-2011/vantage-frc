-- Bin/Shelf Locator: physical put-away locations (bin/shelf/zone codes + optional photo) for the
-- existing inventory_items catalog, a quantity-at-location join so an item can live in more than
-- one bin, and an append-only move/put-away log giving a "last seen here" audit trail.
-- Distinct from 0037 inventory_locations (a single free-text location per item): this is a
-- dedicated locator layer with printable QR/SVG labels and scan-to-find lookup.

CREATE TABLE bin_shelf_locator_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  kind text NOT NULL DEFAULT 'bin' CHECK (kind IN ('bin', 'shelf', 'zone', 'cart', 'drawer', 'other')),
  zone text,
  photo_url text,
  notes text NOT NULL DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE INDEX bin_shelf_locator_locations_org_idx ON bin_shelf_locator_locations(org_id, archived);

-- Quantity-at-location: which items sit in which locations, and how many.
CREATE TABLE bin_shelf_locator_item_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES bin_shelf_locator_locations(id) ON DELETE CASCADE,
  quantity numeric(12, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, item_id, location_id)
);
CREATE INDEX bin_shelf_locator_item_locations_org_idx ON bin_shelf_locator_item_locations(org_id, item_id);
CREATE INDEX bin_shelf_locator_item_locations_loc_idx ON bin_shelf_locator_item_locations(org_id, location_id);

-- Append-only move/put-away log: every scan or manual move gets a row, giving "last seen here".
CREATE TABLE bin_shelf_locator_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  from_location_id uuid REFERENCES bin_shelf_locator_locations(id) ON DELETE SET NULL,
  to_location_id uuid REFERENCES bin_shelf_locator_locations(id) ON DELETE SET NULL,
  quantity numeric(12, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  method text NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'scan', 'putaway', 'audit')),
  note text NOT NULL DEFAULT '',
  moved_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bin_shelf_locator_moves_org_idx ON bin_shelf_locator_moves(org_id, item_id, created_at DESC);
CREATE INDEX bin_shelf_locator_moves_loc_idx ON bin_shelf_locator_moves(org_id, to_location_id, created_at DESC);

ALTER TABLE bin_shelf_locator_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bin_shelf_locator_item_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bin_shelf_locator_moves ENABLE ROW LEVEL SECURITY;

CREATE POLICY bin_shelf_locator_locations_read ON bin_shelf_locator_locations FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY bin_shelf_locator_locations_insert ON bin_shelf_locator_locations FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY bin_shelf_locator_locations_update ON bin_shelf_locator_locations FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY bin_shelf_locator_locations_delete ON bin_shelf_locator_locations FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY bin_shelf_locator_item_locations_read ON bin_shelf_locator_item_locations FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY bin_shelf_locator_item_locations_insert ON bin_shelf_locator_item_locations FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY bin_shelf_locator_item_locations_update ON bin_shelf_locator_item_locations FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY bin_shelf_locator_item_locations_delete ON bin_shelf_locator_item_locations FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY bin_shelf_locator_moves_read ON bin_shelf_locator_moves FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY bin_shelf_locator_moves_insert ON bin_shelf_locator_moves FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND moved_by = current_app_user_id());
CREATE POLICY bin_shelf_locator_moves_update ON bin_shelf_locator_moves FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY bin_shelf_locator_moves_delete ON bin_shelf_locator_moves FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON bin_shelf_locator_locations, bin_shelf_locator_item_locations, bin_shelf_locator_moves TO vantage_app, vantage_worker;
