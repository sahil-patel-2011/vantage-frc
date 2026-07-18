-- Tool/equipment checkout: the shop tool registry plus the loan record that tracks
-- who currently has each tool and when it's due back — bus-factor protection for tools
-- (drills, calipers, chargers, laptops…) the way 0038 tracks bus-factor for people-knowledge.

CREATE TABLE tool_checkout_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('power_tool','hand_tool','measurement','electronics','computer','safety','other')),
  asset_tag text,
  location text,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_checkout_tools_org_idx ON tool_checkout_tools(org_id, active, name);

ALTER TABLE tool_checkout_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY tool_checkout_tools_member_read ON tool_checkout_tools FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY tool_checkout_tools_member_insert ON tool_checkout_tools FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY tool_checkout_tools_member_update ON tool_checkout_tools FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY tool_checkout_tools_member_delete ON tool_checkout_tools FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON tool_checkout_tools TO vantage_app, vantage_worker;

CREATE TABLE tool_checkout_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tool_id uuid NOT NULL REFERENCES tool_checkout_tools(id) ON DELETE CASCADE,
  borrower_name text NOT NULL,
  checked_out_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  returned_at timestamptz,
  notes text,
  checked_out_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_checkout_loans_org_tool_idx ON tool_checkout_loans(org_id, tool_id, returned_at);
CREATE INDEX tool_checkout_loans_org_open_idx ON tool_checkout_loans(org_id, returned_at) WHERE returned_at IS NULL;

ALTER TABLE tool_checkout_loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY tool_checkout_loans_member_read ON tool_checkout_loans FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY tool_checkout_loans_member_insert ON tool_checkout_loans FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND checked_out_by = current_app_user_id());
CREATE POLICY tool_checkout_loans_member_update ON tool_checkout_loans FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY tool_checkout_loans_member_delete ON tool_checkout_loans FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON tool_checkout_loans TO vantage_app, vantage_worker;
