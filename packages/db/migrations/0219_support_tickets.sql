-- Platform support tickets: any org member can submit when something breaks;
-- platform admins triage (status + response). Members see only their own tickets.
--
-- Neon may already have the legacy 0115 support-desk shape (category/page_url/created_by
-- + support_ticket_messages) without this migration recorded. Empty desk tables are
-- replaced so Soft-UI /support + /admin/support match the Drizzle schema.

DROP TABLE IF EXISTS support_ticket_messages CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'support_tickets'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'support_tickets'
      AND column_name = 'user_id'
  ) THEN
    DROP TABLE support_tickets CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS support_tickets (
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

CREATE INDEX IF NOT EXISTS support_tickets_user_created_idx
  ON support_tickets(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_org_created_idx
  ON support_tickets(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_status_created_idx
  ON support_tickets(status, created_at DESC);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Drop legacy desk policies and recreate Soft-UI policies.
DROP POLICY IF EXISTS support_tickets_read ON support_tickets;
DROP POLICY IF EXISTS support_tickets_update ON support_tickets;
DROP POLICY IF EXISTS support_tickets_select ON support_tickets;
DROP POLICY IF EXISTS support_tickets_insert ON support_tickets;
DROP POLICY IF EXISTS support_tickets_admin_update ON support_tickets;

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
