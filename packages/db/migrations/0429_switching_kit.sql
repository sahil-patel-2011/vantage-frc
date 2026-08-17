-- Switching kit, self-serve team claim, consent membership link, Nexus cache.

ALTER TABLE consent_records
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS consent_records_org_user_idx
  ON consent_records(org_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE import_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('notion', 'google_calendar', 'ics', 'csv')),
  status text NOT NULL DEFAULT 'setup_required'
    CHECK (status IN ('setup_required', 'connected', 'error', 'disconnected')),
  label text NOT NULL DEFAULT '',
  source_url text,
  last_error text,
  last_synced_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_connections_org_idx ON import_connections(org_id, provider);

CREATE TABLE calendar_inbound_feeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES import_connections(id) ON DELETE CASCADE,
  ics_url text NOT NULL,
  last_uid text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX calendar_inbound_feeds_org_idx ON calendar_inbound_feeds(org_id);

ALTER TABLE subteam_calendar_events
  ADD COLUMN IF NOT EXISTS import_uid text;
CREATE UNIQUE INDEX IF NOT EXISTS subteam_calendar_events_import_uid_uq
  ON subteam_calendar_events(org_id, import_uid)
  WHERE import_uid IS NOT NULL;

CREATE TABLE nexus_event_snapshots (
  event_key text PRIMARY KEY,
  pits jsonb NOT NULL DEFAULT '{}'::jsonb,
  live jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE import_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_inbound_feeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexus_event_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_connections_member_read ON import_connections
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY import_connections_admin_write ON import_connections
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY calendar_inbound_feeds_member_read ON calendar_inbound_feeds
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY calendar_inbound_feeds_admin_write ON calendar_inbound_feeds
  FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner', 'admin']::org_role[]));

CREATE POLICY nexus_event_snapshots_member_read ON nexus_event_snapshots
  FOR SELECT TO vantage_app USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON import_connections, calendar_inbound_feeds TO vantage_app, vantage_worker;
GRANT SELECT ON nexus_event_snapshots TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON nexus_event_snapshots TO vantage_worker;

CREATE OR REPLACE FUNCTION claim_frc_team_workspace(
  p_name text,
  p_slug text,
  p_team_number integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  app_user users%ROWTYPE;
  org_id uuid;
BEGIN
  SELECT * INTO app_user FROM users WHERE id = current_app_user_id();
  IF app_user.id IS NULL OR NOT app_user.email_verified THEN
    RAISE EXCEPTION 'A verified Vantage account is required to claim a team';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'Team name is required';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'Slug must use lowercase letters, numbers, and hyphens';
  END IF;
  IF p_team_number IS NULL OR p_team_number < 1 OR p_team_number > 99999 THEN
    RAISE EXCEPTION 'Team number must be between 1 and 99999';
  END IF;
  IF EXISTS (SELECT 1 FROM organizations WHERE team_number = p_team_number) THEN
    RAISE EXCEPTION 'FRC team % already has a Vantage workspace', p_team_number;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams_ref WHERE team_number = p_team_number) THEN
    RAISE EXCEPTION 'FRC team % is not in the TBA cache yet. Sync live data or ask a platform admin.', p_team_number;
  END IF;
  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = app_user.id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'This account already owns a Vantage workspace';
  END IF;

  INSERT INTO organizations(name, slug, team_number)
  VALUES (trim(p_name), p_slug, p_team_number)
  RETURNING id INTO org_id;

  INSERT INTO memberships(org_id, user_id, role) VALUES (org_id, app_user.id, 'owner');
  INSERT INTO org_billing(org_id, tier, credit_cap_usd, period_start, period_end)
  VALUES (
    org_id,
    'free',
    0,
    date_trunc('month', now()),
    date_trunc('month', now()) + interval '1 month'
  );
  INSERT INTO membership_audit_events(org_id, actor_user_id, action, metadata)
  VALUES (
    org_id,
    app_user.id,
    'organization.claimed',
    jsonb_build_object('teamNumber', p_team_number, 'slug', p_slug)
  );
  RETURN org_id;
END;
$$;

REVOKE ALL ON FUNCTION claim_frc_team_workspace(text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_frc_team_workspace(text, text, integer) TO vantage_app;

CREATE TABLE district_trajectory_sim_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  team_number integer,
  district_key text NOT NULL,
  season_year integer NOT NULL,
  sim_runs integer NOT NULL,
  baseline_epa double precision,
  events_remaining integer NOT NULL,
  qualify_probability double precision NOT NULL,
  points_needed double precision,
  projected_points_p10 double precision,
  projected_points_p50 double precision,
  projected_points_p90 double precision,
  probability_curve jsonb NOT NULL DEFAULT '[]'::jsonb,
  scenario jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX district_trajectory_sim_runs_org_idx
  ON district_trajectory_sim_runs(org_id, season_year, created_at DESC);

CREATE TABLE district_trajectory_sim_projections (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  team_number integer,
  season_year integer NOT NULL,
  sim_runs integer NOT NULL,
  qualify_probability double precision NOT NULL,
  points_needed double precision,
  run_id uuid REFERENCES district_trajectory_sim_runs(id) ON DELETE SET NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, team_key, season_year)
);

CREATE TABLE district_trajectory_sim_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_key text NOT NULL,
  season_year integer NOT NULL,
  label text NOT NULL,
  epa_delta_pct double precision NOT NULL DEFAULT 0,
  skip_next_event boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX district_trajectory_sim_scenarios_org_idx
  ON district_trajectory_sim_scenarios(org_id, team_key, season_year);

ALTER TABLE district_trajectory_sim_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE district_trajectory_sim_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE district_trajectory_sim_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY district_traj_runs_member ON district_trajectory_sim_runs
  FOR ALL TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY district_traj_proj_member ON district_trajectory_sim_projections
  FOR ALL TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY district_traj_scen_member ON district_trajectory_sim_scenarios
  FOR ALL TO vantage_app USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON district_trajectory_sim_runs, district_trajectory_sim_projections, district_trajectory_sim_scenarios TO vantage_app, vantage_worker;
