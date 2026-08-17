-- Org-private edge: pEPA snapshots, scout-field calibration vs TBA, pit signals from scouts.
-- All org-scoped. Never a public Statbotics clone.

CREATE TABLE private_epa_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  public_epa numeric(10, 4) NOT NULL,
  pepa numeric(10, 4) NOT NULL,
  scout_component_epa numeric(10, 4) NOT NULL,
  scout_sample integer NOT NULL CHECK (scout_sample >= 0),
  components jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, team_key)
);
CREATE INDEX private_epa_snapshots_org_event_idx
  ON private_epa_snapshots(org_id, event_key, computed_at DESC);

CREATE TABLE scout_field_reliability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  field_key text NOT NULL,
  scout_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agreement_rate numeric(5, 4) NOT NULL CHECK (agreement_rate >= 0 AND agreement_rate <= 1),
  n_samples integer NOT NULL CHECK (n_samples >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, field_key, scout_user_id)
);
CREATE INDEX scout_field_reliability_org_event_idx
  ON scout_field_reliability(org_id, event_key, updated_at DESC);

CREATE TABLE scout_pit_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  match_key text REFERENCES matches_ref(match_key),
  scout_entry_id uuid REFERENCES match_scout_entries(id) ON DELETE CASCADE,
  signal_kind text NOT NULL
    CHECK (signal_kind IN ('intake_jam', 'disabled', 'climb_fail', 'defense_contact', 'other')),
  note text NOT NULL DEFAULT '',
  alliance_color text CHECK (alliance_color IN ('red', 'blue')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, scout_entry_id, signal_kind)
);
CREATE INDEX scout_pit_signals_org_event_idx
  ON scout_pit_signals(org_id, event_key, created_at DESC);

CREATE TABLE cad_scout_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subsystem_id uuid NOT NULL REFERENCES robot_subsystems(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, subsystem_id, field_key)
);

ALTER TABLE private_epa_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_field_reliability ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_pit_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE cad_scout_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY private_epa_snapshots_member_read ON private_epa_snapshots
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY private_epa_snapshots_member_write ON private_epa_snapshots
  FOR ALL TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE POLICY scout_field_reliability_member_read ON scout_field_reliability
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY scout_field_reliability_member_write ON scout_field_reliability
  FOR ALL TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

CREATE POLICY scout_pit_signals_member_read ON scout_pit_signals
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY scout_pit_signals_member_insert ON scout_pit_signals
  FOR INSERT TO vantage_app WITH CHECK (is_org_member(org_id));

CREATE POLICY cad_scout_links_member_read ON cad_scout_links
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY cad_scout_links_member_write ON cad_scout_links
  FOR ALL TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

-- Pit crew pings from scouts: members may insert org_live_alerts of type scout_pit only.
CREATE POLICY org_live_alerts_scout_pit_insert ON org_live_alerts
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND type = 'scout_pit');

GRANT SELECT, INSERT, UPDATE, DELETE ON private_epa_snapshots, scout_field_reliability, cad_scout_links
  TO vantage_app, vantage_worker;
GRANT SELECT, INSERT ON scout_pit_signals TO vantage_app, vantage_worker;
GRANT UPDATE, DELETE ON scout_pit_signals TO vantage_worker;
