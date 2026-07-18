-- Consumables / Spares: shop consumables (fasteners, wire, tape, PPE) with on-hand counts and
-- reorder points. The app flags low/out items for reorder. Org-scoped, persistent across
-- seasons, per-org RLS.

CREATE TABLE consumables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('fasteners','electrical','pneumatics','adhesives','stock','tools','ppe','other')),
  unit text NOT NULL DEFAULT 'each',
  on_hand numeric(12,2) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reorder_point numeric(12,2) NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  preferred_vendor text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consumables_org_idx ON consumables(org_id, category);

ALTER TABLE consumables ENABLE ROW LEVEL SECURITY;

CREATE POLICY consumables_member_read ON consumables FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY consumables_member_insert ON consumables FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY consumables_member_update ON consumables FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY consumables_member_delete ON consumables FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON consumables TO vantage_app, vantage_worker;
