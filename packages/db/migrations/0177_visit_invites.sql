-- Come see what we do: shop tours and demo days with hosts, student demos, and RSVPs.
-- Org-scoped via RLS. Empty until mentors schedule real visits ? no demo seeds.

CREATE TABLE IF NOT EXISTS visit_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('shop_tour', 'demo_day')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  location text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  capacity integer CHECK (capacity IS NULL OR (capacity >= 1 AND capacity <= 500)),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'done', 'cancelled')),
  calendar_event_id uuid REFERENCES subteam_calendar_events(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS visit_invites_org_idx
  ON visit_invites(org_id, starts_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS visit_invites_calendar_idx
  ON visit_invites(calendar_event_id)
  WHERE calendar_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS visit_invite_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES visit_invites(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  host_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visit_invite_hosts_visit_idx
  ON visit_invite_hosts(org_id, visit_id);

CREATE TABLE IF NOT EXISTS visit_invite_demos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES visit_invites(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  student_name text NOT NULL DEFAULT '',
  demo_title text NOT NULL CHECK (char_length(demo_title) BETWEEN 1 AND 200),
  notes text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visit_invite_demos_visit_idx
  ON visit_invite_demos(org_id, visit_id, sort_order);

CREATE TABLE IF NOT EXISTS visit_invite_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES visit_invites(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  guest_name text NOT NULL DEFAULT '',
  guest_email text NOT NULL DEFAULT '',
  party_size integer NOT NULL DEFAULT 1
    CHECK (party_size >= 1 AND party_size <= 50),
  response text NOT NULL CHECK (response IN ('going', 'maybe', 'no')),
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  responded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR char_length(trim(guest_name)) > 0)
);

CREATE INDEX IF NOT EXISTS visit_invite_rsvps_visit_idx
  ON visit_invite_rsvps(org_id, visit_id, response);
CREATE UNIQUE INDEX IF NOT EXISTS visit_invite_rsvps_visit_user_uidx
  ON visit_invite_rsvps(visit_id, user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE visit_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_invite_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_invite_demos ENABLE ROW LEVEL SECURITY;
ALTER TABLE visit_invite_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visit_invites_read ON visit_invites;
DROP POLICY IF EXISTS visit_invites_insert ON visit_invites;
DROP POLICY IF EXISTS visit_invites_update ON visit_invites;
DROP POLICY IF EXISTS visit_invites_delete ON visit_invites;
CREATE POLICY visit_invites_read ON visit_invites
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY visit_invites_insert ON visit_invites
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY visit_invites_update ON visit_invites
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY visit_invites_delete ON visit_invites
  FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

DROP POLICY IF EXISTS visit_invite_hosts_read ON visit_invite_hosts;
DROP POLICY IF EXISTS visit_invite_hosts_insert ON visit_invite_hosts;
DROP POLICY IF EXISTS visit_invite_hosts_update ON visit_invite_hosts;
DROP POLICY IF EXISTS visit_invite_hosts_delete ON visit_invite_hosts;
CREATE POLICY visit_invite_hosts_read ON visit_invite_hosts
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY visit_invite_hosts_insert ON visit_invite_hosts
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY visit_invite_hosts_update ON visit_invite_hosts
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY visit_invite_hosts_delete ON visit_invite_hosts
  FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

DROP POLICY IF EXISTS visit_invite_demos_read ON visit_invite_demos;
DROP POLICY IF EXISTS visit_invite_demos_insert ON visit_invite_demos;
DROP POLICY IF EXISTS visit_invite_demos_update ON visit_invite_demos;
DROP POLICY IF EXISTS visit_invite_demos_delete ON visit_invite_demos;
CREATE POLICY visit_invite_demos_read ON visit_invite_demos
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY visit_invite_demos_insert ON visit_invite_demos
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY visit_invite_demos_update ON visit_invite_demos
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY visit_invite_demos_delete ON visit_invite_demos
  FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

DROP POLICY IF EXISTS visit_invite_rsvps_read ON visit_invite_rsvps;
DROP POLICY IF EXISTS visit_invite_rsvps_insert ON visit_invite_rsvps;
DROP POLICY IF EXISTS visit_invite_rsvps_update ON visit_invite_rsvps;
DROP POLICY IF EXISTS visit_invite_rsvps_delete ON visit_invite_rsvps;
CREATE POLICY visit_invite_rsvps_read ON visit_invite_rsvps
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY visit_invite_rsvps_insert ON visit_invite_rsvps
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY visit_invite_rsvps_update ON visit_invite_rsvps
  FOR UPDATE TO vantage_app
  USING (
    user_id = current_app_user_id()
    OR created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  )
  WITH CHECK (is_org_member(org_id));
CREATE POLICY visit_invite_rsvps_delete ON visit_invite_rsvps
  FOR DELETE TO vantage_app
  USING (
    user_id = current_app_user_id()
    OR created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON
  visit_invites,
  visit_invite_hosts,
  visit_invite_demos,
  visit_invite_rsvps
  TO vantage_app, vantage_worker;
