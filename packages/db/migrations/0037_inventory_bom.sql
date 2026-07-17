-- Inventory & Bill-of-Materials.
-- Physical parts/materials stock (motors, gearboxes, electronics, raw stock, spares),
-- where they live, an append-only stock-movement ledger, and per-mechanism BOM needs
-- so a team can answer "what do we have, what's running low, and can we build subsystem X".

CREATE TABLE inventory_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'shelf' CHECK (kind IN ('shelf', 'bin', 'cart', 'pit', 'trailer', 'other')),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('motor', 'gearbox', 'wheel', 'electronics', 'pneumatics', 'hardware', 'raw_stock', 'tool', 'battery', 'spare', 'other')),
  part_number text,
  vendor text,
  unit text NOT NULL DEFAULT 'each',
  quantity numeric(12, 2) NOT NULL DEFAULT 0,
  min_quantity numeric(12, 2) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  unit_cost numeric(12, 2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  location_id uuid REFERENCES inventory_locations(id) ON DELETE SET NULL,
  subsystem text,
  notes text NOT NULL DEFAULT '',
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_items_org_idx ON inventory_items(org_id, archived, category);

-- Append-only stock-movement ledger. inventory_items.quantity is the running total,
-- maintained by the API in the same transaction that appends the ledger row.
CREATE TABLE inventory_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  delta numeric(12, 2) NOT NULL,
  reason text NOT NULL DEFAULT 'adjust' CHECK (reason IN ('received', 'used', 'adjust', 'return', 'damaged')),
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_transactions_item_idx ON inventory_transactions(item_id, created_at DESC);

CREATE TABLE bom_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subsystem text NOT NULL,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity_needed numeric(12, 2) NOT NULL CHECK (quantity_needed > 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, subsystem, item_id)
);
CREATE INDEX bom_entries_org_idx ON bom_entries(org_id, subsystem);

ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_entries ENABLE ROW LEVEL SECURITY;

-- Members collaborate on inventory; destructive deletes limited to the row creator
-- or an owner/admin. The ledger is insert-only (no update/delete policy).
CREATE POLICY inventory_locations_read ON inventory_locations FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY inventory_locations_insert ON inventory_locations FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY inventory_locations_update ON inventory_locations FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY inventory_locations_delete ON inventory_locations FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY inventory_items_read ON inventory_items FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY inventory_items_insert ON inventory_items FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY inventory_items_update ON inventory_items FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY inventory_items_delete ON inventory_items FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY inventory_tx_read ON inventory_transactions FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY inventory_tx_insert ON inventory_transactions FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

CREATE POLICY bom_read ON bom_entries FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY bom_insert ON bom_entries FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY bom_update ON bom_entries FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY bom_delete ON bom_entries FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_locations, inventory_items, inventory_transactions, bom_entries TO vantage_app, vantage_worker;
