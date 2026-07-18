-- Vendor / Supplier Directory: a team's known suppliers (COTS, raw stock, tools, services)
-- with contact info, lead time, rating, and a preferred flag. Org-scoped and persistent
-- across seasons (no season_year). Per-org RLS.

CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('electronics','hardware','raw_materials','tools','services','apparel','shipping','other')),
  website text,
  contact_name text,
  contact_email text,
  contact_phone text,
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  rating integer CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  preferred boolean NOT NULL DEFAULT false,
  account_number text,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendors_org_idx ON vendors(org_id, category);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendors_member_read ON vendors FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY vendors_member_insert ON vendors FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY vendors_member_update ON vendors FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY vendors_member_delete ON vendors FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON vendors TO vantage_app, vantage_worker;
