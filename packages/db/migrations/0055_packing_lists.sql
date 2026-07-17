-- Competition Packing Lists.
-- Per-event load-out checklists (seeded from a standard FRC competition template)
-- so nothing gets left in the shop: batteries, chargers, spares, tools, drive
-- station, safety gear. Items check off as they're packed.

CREATE TABLE packing_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  event_key text REFERENCES events_ref(event_key),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX packing_lists_org_idx ON packing_lists(org_id, updated_at DESC);

CREATE TABLE packing_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES packing_lists(id) ON DELETE CASCADE,
  category text NOT NULL,
  label text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 10000),
  packed boolean NOT NULL DEFAULT false,
  packed_by uuid REFERENCES users(id),
  packed_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX packing_items_list_idx ON packing_items(list_id, category, sort_order);

ALTER TABLE packing_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE packing_items ENABLE ROW LEVEL SECURITY;

-- Packing is a whole-team activity: members read/write; list deletion is limited
-- to the creator or an owner/admin.
CREATE POLICY packing_lists_read ON packing_lists FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY packing_lists_insert ON packing_lists FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY packing_lists_update ON packing_lists FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY packing_lists_delete ON packing_lists FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY packing_items_read ON packing_items FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY packing_items_insert ON packing_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY packing_items_update ON packing_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY packing_items_delete ON packing_items FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON packing_lists, packing_items TO vantage_app, vantage_worker;
