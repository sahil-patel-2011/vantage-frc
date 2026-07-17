-- Team-run fundraiser events (car wash, bottle drive, restaurant night, product
-- sale). Distinct from the corporate-sponsor CRM. Recorded proceeds also post to
-- the finance ledger as income via the existing 'fundraiser' transaction source.

CREATE TABLE fundraiser_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'other'
    CHECK (type IN ('car_wash', 'bottle_drive', 'restaurant_night', 'bake_sale', 'product_sale', 'crowdfunding', 'event_ticket', 'other')),
  event_date date NOT NULL,
  goal_usd numeric(12, 2) CHECK (goal_usd IS NULL OR goal_usd >= 0),
  proceeds_usd numeric(12, 2) NOT NULL DEFAULT 0 CHECK (proceeds_usd >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  location text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fundraiser_events_org_season_idx ON fundraiser_events(org_id, season_year, event_date DESC);

ALTER TABLE fundraiser_events ENABLE ROW LEVEL SECURITY;

-- Planning a fundraiser is collaborative (any member). Recording proceeds posts
-- money to the finance ledger, whose own RLS restricts that to owners/admins.
CREATE POLICY fundraiser_events_read ON fundraiser_events FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY fundraiser_events_insert ON fundraiser_events FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY fundraiser_events_update ON fundraiser_events FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY fundraiser_events_delete ON fundraiser_events FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON fundraiser_events TO vantage_app, vantage_worker;
