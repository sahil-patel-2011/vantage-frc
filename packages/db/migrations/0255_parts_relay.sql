-- FRC Parts Relay: inter-team parts lend/borrow board at events. `parts_relay_listings` are an
-- org's own posted needs ("we need a spare 775pro") and offers ("we have spare wheels to lend").
-- `parts_relay_loans` tracks the actual hand-off with another team once a listing is matched,
-- including expected/actual return so a team can see what is out the door and what is overdue.

CREATE TABLE parts_relay_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  listing_type text NOT NULL CHECK (listing_type IN ('need', 'offer')),
  part_name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('electrical', 'mechanical', 'pneumatic', 'electronics', 'fasteners', 'battery', 'wheels', 'other')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  condition text NOT NULL DEFAULT 'any' CHECK (condition IN ('new', 'used', 'any')),
  event_key text,
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'matched', 'fulfilled', 'cancelled')),
  posted_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parts_relay_listings_org_status_idx ON parts_relay_listings(org_id, status, created_at DESC);
CREATE INDEX parts_relay_listings_org_event_idx ON parts_relay_listings(org_id, event_key);

ALTER TABLE parts_relay_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY parts_relay_listings_member_read ON parts_relay_listings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY parts_relay_listings_member_insert ON parts_relay_listings FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND posted_by = current_app_user_id());
CREATE POLICY parts_relay_listings_member_update ON parts_relay_listings FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY parts_relay_listings_member_delete ON parts_relay_listings FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON parts_relay_listings TO vantage_app, vantage_worker;

CREATE TABLE parts_relay_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  listing_id uuid REFERENCES parts_relay_listings(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('lending', 'borrowing')),
  counterparty_team text NOT NULL,
  part_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  event_key text,
  loaned_on date NOT NULL,
  due_back_on date,
  returned_on date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'overdue', 'lost')),
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX parts_relay_loans_org_status_idx ON parts_relay_loans(org_id, status, loaned_on DESC);
CREATE INDEX parts_relay_loans_org_event_idx ON parts_relay_loans(org_id, event_key);

ALTER TABLE parts_relay_loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY parts_relay_loans_member_read ON parts_relay_loans FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY parts_relay_loans_member_insert ON parts_relay_loans FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY parts_relay_loans_member_update ON parts_relay_loans FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY parts_relay_loans_member_delete ON parts_relay_loans FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON parts_relay_loans TO vantage_app, vantage_worker;
