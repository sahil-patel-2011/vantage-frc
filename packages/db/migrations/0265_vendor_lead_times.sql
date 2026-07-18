-- Vendor lead-time tracker: vendors with known shipping lead times, and reorder lines whose
-- "order by" date is calculated from a needed-by date minus the vendor's lead time + safety
-- buffer. Distinct from packages/reference vendor/purchasing data — this is a lightweight,
-- team-entered log, not a synced catalog.

CREATE TABLE vendor_lead_times_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  lead_time_days integer NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  safety_buffer_days integer NOT NULL DEFAULT 0 CHECK (safety_buffer_days >= 0),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendor_lead_times_vendors_org_idx ON vendor_lead_times_vendors(org_id, name);

ALTER TABLE vendor_lead_times_vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_lead_times_vendors_member_read ON vendor_lead_times_vendors FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY vendor_lead_times_vendors_member_insert ON vendor_lead_times_vendors FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY vendor_lead_times_vendors_member_update ON vendor_lead_times_vendors FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY vendor_lead_times_vendors_member_delete ON vendor_lead_times_vendors FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_lead_times_vendors TO vantage_app, vantage_worker;

CREATE TABLE vendor_lead_times_reorders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES vendor_lead_times_vendors(id) ON DELETE CASCADE,
  item_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  needed_by date NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','ordered','received','cancelled')),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendor_lead_times_reorders_org_idx ON vendor_lead_times_reorders(org_id, needed_by);
CREATE INDEX vendor_lead_times_reorders_vendor_idx ON vendor_lead_times_reorders(vendor_id);

ALTER TABLE vendor_lead_times_reorders ENABLE ROW LEVEL SECURITY;

CREATE POLICY vendor_lead_times_reorders_member_read ON vendor_lead_times_reorders FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY vendor_lead_times_reorders_member_insert ON vendor_lead_times_reorders FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY vendor_lead_times_reorders_member_update ON vendor_lead_times_reorders FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY vendor_lead_times_reorders_member_delete ON vendor_lead_times_reorders FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_lead_times_reorders TO vantage_app, vantage_worker;
