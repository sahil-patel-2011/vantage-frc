-- Driver Practice & Cycle-Time Log.
-- Drive-team practice sessions and the individual scoring/cycle reps logged within
-- them, so a team can track cycle times, success rates, and driver improvement over
-- the season. Standalone — needs no TBA/live data.

CREATE TABLE driver_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  event_key text REFERENCES events_ref(event_key),
  session_date date NOT NULL DEFAULT current_date,
  driver_user_id uuid REFERENCES users(id),
  driver_name text,
  location text NOT NULL DEFAULT '',
  goal text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_sessions_org_idx ON driver_sessions(org_id, session_date DESC);

-- One row per scoring attempt / cycle. seconds is optional (some reps track only
-- make/miss); the app aggregates cycle time and success rate from these rows.
CREATE TABLE driver_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES driver_sessions(id) ON DELETE CASCADE,
  action text NOT NULL,
  seconds numeric(6, 2) CHECK (seconds IS NULL OR (seconds >= 0 AND seconds <= 3600)),
  success boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  rep_index integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_cycles_session_idx ON driver_cycles(session_id, rep_index);

ALTER TABLE driver_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_cycles ENABLE ROW LEVEL SECURITY;

-- Any member can log and edit practice data; deleting a whole session is limited to
-- its creator or an owner/admin.
CREATE POLICY driver_sessions_read ON driver_sessions FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY driver_sessions_insert ON driver_sessions FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY driver_sessions_update ON driver_sessions FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY driver_sessions_delete ON driver_sessions FOR DELETE TO vantage_app USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY driver_cycles_read ON driver_cycles FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY driver_cycles_insert ON driver_cycles FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY driver_cycles_update ON driver_cycles FOR UPDATE TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY driver_cycles_delete ON driver_cycles FOR DELETE TO vantage_app USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON driver_sessions, driver_cycles TO vantage_app, vantage_worker;
