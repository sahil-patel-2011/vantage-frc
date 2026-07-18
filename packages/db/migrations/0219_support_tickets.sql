-- Platform support tickets: any org member can submit when something breaks;
-- platform admins triage (status + response). Members see only their own tickets.

CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 8000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  admin_response text CHECK (admin_response IS NULL OR char_length(btrim(admin_response)) <= 8000),
  admin_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_tickets_user_created_idx
  ON support_tickets(user_id, created_at DESC);
CREATE INDEX support_tickets_org_created_idx
  ON support_tickets(org_id, created_at DESC);
CREATE INDEX support_tickets_status_created_idx
  ON support_tickets(status, created_at DESC);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Submitters see only their own tickets; platform admins see everything.
CREATE POLICY support_tickets_select ON support_tickets FOR SELECT TO vantage_app
  USING (user_id = current_app_user_id() OR is_platform_admin());

CREATE POLICY support_tickets_insert ON support_tickets FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND user_id = current_app_user_id()
  );

-- Only platform admins triage (status / response). Members cannot edit after submit.
CREATE POLICY support_tickets_admin_update ON support_tickets FOR UPDATE TO vantage_app
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON support_tickets TO vantage_app, vantage_worker;
