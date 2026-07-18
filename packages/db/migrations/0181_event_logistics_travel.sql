-- Event logistics: trips, lodging, rooming lists, travel legs, checklists,
-- emergency contacts, and on-duty mentor slots. Org-scoped only — no cross-tenant
-- seeds. Travel leg kinds mirror team calendar / my-day surfaces.

CREATE TABLE IF NOT EXISTS logistics_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  event_key text,
  venue_name text NOT NULL DEFAULT '',
  venue_address text NOT NULL DEFAULT '',
  travel_notes text NOT NULL DEFAULT '',
  transport_notes text NOT NULL DEFAULT '',
  starts_on date,
  ends_on date,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logistics_trips_org_idx
  ON logistics_trips(org_id, starts_on);

CREATE TABLE IF NOT EXISTS logistics_hotels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES logistics_trips(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  confirmation_code text NOT NULL DEFAULT '',
  check_in_at timestamptz,
  check_out_at timestamptz,
  room_block_notes text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logistics_hotels_trip_idx
  ON logistics_hotels(org_id, trip_id);

CREATE TABLE IF NOT EXISTS logistics_room_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  hotel_id uuid NOT NULL REFERENCES logistics_hotels(id) ON DELETE CASCADE,
  room_label text NOT NULL CHECK (char_length(room_label) BETWEEN 1 AND 80),
  occupant_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occupant_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logistics_rooms_hotel_idx
  ON logistics_room_assignments(org_id, hotel_id);

CREATE TABLE IF NOT EXISTS logistics_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES logistics_trips(id) ON DELETE CASCADE,
  audience text NOT NULL DEFAULT 'all'
    CHECK (audience IN ('student', 'mentor', 'all')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 240),
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logistics_checklist_org_idx
  ON logistics_checklist_items(org_id, trip_id, sort_order);

CREATE TABLE IF NOT EXISTS logistics_checklist_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES logistics_checklist_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, user_id)
);

CREATE INDEX IF NOT EXISTS logistics_checks_user_idx
  ON logistics_checklist_checks(org_id, user_id);

CREATE TABLE IF NOT EXISTS logistics_emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  role_label text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_primary boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logistics_contacts_org_idx
  ON logistics_emergency_contacts(org_id, sort_order);

CREATE TABLE IF NOT EXISTS logistics_on_duty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES logistics_trips(id) ON DELETE CASCADE,
  mentor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  mentor_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz CHECK (ends_at IS NULL OR ends_at >= starts_at),
  location_note text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logistics_on_duty_org_idx
  ON logistics_on_duty(org_id, starts_at);

CREATE TABLE IF NOT EXISTS logistics_travel_legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES logistics_trips(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'depart_home',
    'arrive_hotel',
    'depart_hotel',
    'arrive_venue',
    'depart_venue',
    'return_home'
  )),
  title text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz CHECK (ends_at IS NULL OR ends_at >= starts_at),
  location text NOT NULL DEFAULT '',
  meeting_point text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  subteam_id uuid REFERENCES team_subteams(id) ON DELETE SET NULL,
  calendar_event_id uuid REFERENCES subteam_calendar_events(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logistics_travel_legs_trip_idx
  ON logistics_travel_legs(org_id, trip_id, starts_at);

-- RLS: members read shared logistics; app gates mentor/admin writes on mutations.
ALTER TABLE logistics_trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_hotels ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_room_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_checklist_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_on_duty ENABLE ROW LEVEL SECURITY;
ALTER TABLE logistics_travel_legs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS logistics_trips_member_read ON logistics_trips;
DROP POLICY IF EXISTS logistics_trips_member_insert ON logistics_trips;
DROP POLICY IF EXISTS logistics_trips_member_update ON logistics_trips;
DROP POLICY IF EXISTS logistics_trips_member_delete ON logistics_trips;
CREATE POLICY logistics_trips_member_read ON logistics_trips FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY logistics_trips_member_insert ON logistics_trips FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY logistics_trips_member_update ON logistics_trips FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY logistics_trips_member_delete ON logistics_trips FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

DROP POLICY IF EXISTS logistics_hotels_member_read ON logistics_hotels;
DROP POLICY IF EXISTS logistics_hotels_member_insert ON logistics_hotels;
DROP POLICY IF EXISTS logistics_hotels_member_update ON logistics_hotels;
DROP POLICY IF EXISTS logistics_hotels_member_delete ON logistics_hotels;
CREATE POLICY logistics_hotels_member_read ON logistics_hotels FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY logistics_hotels_member_insert ON logistics_hotels FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY logistics_hotels_member_update ON logistics_hotels FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY logistics_hotels_member_delete ON logistics_hotels FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

DROP POLICY IF EXISTS logistics_rooms_member_read ON logistics_room_assignments;
DROP POLICY IF EXISTS logistics_rooms_member_insert ON logistics_room_assignments;
DROP POLICY IF EXISTS logistics_rooms_member_update ON logistics_room_assignments;
DROP POLICY IF EXISTS logistics_rooms_member_delete ON logistics_room_assignments;
CREATE POLICY logistics_rooms_member_read ON logistics_room_assignments FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY logistics_rooms_member_insert ON logistics_room_assignments FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY logistics_rooms_member_update ON logistics_room_assignments FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY logistics_rooms_member_delete ON logistics_room_assignments FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

DROP POLICY IF EXISTS logistics_checklist_items_member_read ON logistics_checklist_items;
DROP POLICY IF EXISTS logistics_checklist_items_member_insert ON logistics_checklist_items;
DROP POLICY IF EXISTS logistics_checklist_items_member_update ON logistics_checklist_items;
DROP POLICY IF EXISTS logistics_checklist_items_member_delete ON logistics_checklist_items;
CREATE POLICY logistics_checklist_items_member_read ON logistics_checklist_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY logistics_checklist_items_member_insert ON logistics_checklist_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY logistics_checklist_items_member_update ON logistics_checklist_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY logistics_checklist_items_member_delete ON logistics_checklist_items FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

DROP POLICY IF EXISTS logistics_checklist_checks_member_read ON logistics_checklist_checks;
DROP POLICY IF EXISTS logistics_checklist_checks_self_insert ON logistics_checklist_checks;
DROP POLICY IF EXISTS logistics_checklist_checks_self_update ON logistics_checklist_checks;
DROP POLICY IF EXISTS logistics_checklist_checks_self_delete ON logistics_checklist_checks;
CREATE POLICY logistics_checklist_checks_member_read ON logistics_checklist_checks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY logistics_checklist_checks_self_insert ON logistics_checklist_checks FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND user_id = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM logistics_checklist_items i
      WHERE i.id = item_id AND i.org_id = logistics_checklist_checks.org_id
    )
  );
CREATE POLICY logistics_checklist_checks_self_update ON logistics_checklist_checks FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());
CREATE POLICY logistics_checklist_checks_self_delete ON logistics_checklist_checks FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      user_id = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

DROP POLICY IF EXISTS logistics_contacts_member_read ON logistics_emergency_contacts;
DROP POLICY IF EXISTS logistics_contacts_member_insert ON logistics_emergency_contacts;
DROP POLICY IF EXISTS logistics_contacts_member_update ON logistics_emergency_contacts;
DROP POLICY IF EXISTS logistics_contacts_member_delete ON logistics_emergency_contacts;
CREATE POLICY logistics_contacts_member_read ON logistics_emergency_contacts FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY logistics_contacts_member_insert ON logistics_emergency_contacts FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY logistics_contacts_member_update ON logistics_emergency_contacts FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY logistics_contacts_member_delete ON logistics_emergency_contacts FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

DROP POLICY IF EXISTS logistics_on_duty_member_read ON logistics_on_duty;
DROP POLICY IF EXISTS logistics_on_duty_member_insert ON logistics_on_duty;
DROP POLICY IF EXISTS logistics_on_duty_member_update ON logistics_on_duty;
DROP POLICY IF EXISTS logistics_on_duty_member_delete ON logistics_on_duty;
CREATE POLICY logistics_on_duty_member_read ON logistics_on_duty FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY logistics_on_duty_member_insert ON logistics_on_duty FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY logistics_on_duty_member_update ON logistics_on_duty FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY logistics_on_duty_member_delete ON logistics_on_duty FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

DROP POLICY IF EXISTS logistics_travel_legs_member_read ON logistics_travel_legs;
DROP POLICY IF EXISTS logistics_travel_legs_member_insert ON logistics_travel_legs;
DROP POLICY IF EXISTS logistics_travel_legs_member_update ON logistics_travel_legs;
DROP POLICY IF EXISTS logistics_travel_legs_member_delete ON logistics_travel_legs;
CREATE POLICY logistics_travel_legs_member_read ON logistics_travel_legs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY logistics_travel_legs_member_insert ON logistics_travel_legs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY logistics_travel_legs_member_update ON logistics_travel_legs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY logistics_travel_legs_member_delete ON logistics_travel_legs FOR DELETE TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON
  logistics_trips,
  logistics_hotels,
  logistics_room_assignments,
  logistics_checklist_items,
  logistics_checklist_checks,
  logistics_emergency_contacts,
  logistics_on_duty,
  logistics_travel_legs
TO vantage_app, vantage_worker;
