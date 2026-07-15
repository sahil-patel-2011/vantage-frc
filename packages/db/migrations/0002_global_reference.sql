CREATE TABLE teams_ref (
  team_key text PRIMARY KEY,
  team_number integer UNIQUE NOT NULL CHECK (team_number > 0),
  nickname text,
  name text NOT NULL,
  city text,
  state_prov text,
  country text,
  postal_code text,
  rookie_year integer,
  website text,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teams_ref_number_idx ON teams_ref(team_number);

ALTER TABLE events_ref
  ADD COLUMN short_name text,
  ADD COLUMN week integer,
  ADD COLUMN district_key text,
  ADD COLUMN city text,
  ADD COLUMN state_prov text,
  ADD COLUMN country text,
  ADD COLUMN address text,
  ADD COLUMN postal_code text,
  ADD COLUMN timezone text,
  ADD COLUMN website text,
  ADD COLUMN parent_event_key text,
  ADD COLUMN webcasts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN synced_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX events_ref_year_start_idx ON events_ref(year, start_date);

CREATE TABLE matches_ref (
  match_key text PRIMARY KEY,
  event_key text NOT NULL REFERENCES events_ref(event_key) ON DELETE CASCADE,
  comp_level text NOT NULL,
  set_number integer NOT NULL,
  match_number integer NOT NULL,
  red_alliance jsonb NOT NULL,
  blue_alliance jsonb NOT NULL,
  winning_alliance text,
  event_time timestamptz,
  predicted_time timestamptz,
  actual_time timestamptz,
  post_result_time timestamptz,
  score_breakdown jsonb,
  videos jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matches_ref_event_order_idx
  ON matches_ref(event_key, comp_level, set_number, match_number);

CREATE TABLE team_event_metrics (
  team_key text NOT NULL REFERENCES teams_ref(team_key) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key) ON DELETE CASCADE,
  epa_total double precision,
  epa_auto double precision,
  epa_teleop double precision,
  epa_endgame double precision,
  opr double precision,
  dpr double precision,
  ccwm double precision,
  rank integer,
  wins integer,
  losses integer,
  ties integer,
  source text NOT NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_key, event_key, source)
);
CREATE INDEX team_event_metrics_event_idx
  ON team_event_metrics(event_key, source, rank);

CREATE TABLE team_year_metrics (
  team_key text NOT NULL REFERENCES teams_ref(team_key) ON DELETE CASCADE,
  year integer NOT NULL,
  epa_total double precision,
  epa_auto double precision,
  epa_teleop double precision,
  epa_endgame double precision,
  source text NOT NULL,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_key, year, source)
);
CREATE INDEX team_year_metrics_year_idx
  ON team_year_metrics(year, source, epa_total);

CREATE TABLE sync_cursors (
  source text NOT NULL,
  resource text NOT NULL,
  etag text,
  last_modified text,
  cursor text,
  last_status integer,
  last_error text,
  synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, resource)
);

ALTER TABLE teams_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_event_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_year_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY teams_authenticated_read ON teams_ref FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY matches_authenticated_read ON matches_ref FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY team_event_metrics_authenticated_read ON team_event_metrics FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);
CREATE POLICY team_year_metrics_authenticated_read ON team_year_metrics FOR SELECT TO vantage_app
  USING (current_app_user_id() IS NOT NULL);

GRANT SELECT ON teams_ref, matches_ref, team_event_metrics, team_year_metrics TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON teams_ref, events_ref, matches_ref,
  team_event_metrics, team_year_metrics, sync_cursors, season_windows TO vantage_worker;

INSERT INTO season_windows (year, search_start_date, search_end_date, is_active)
VALUES
  (2025, DATE '2025-01-04', DATE '2025-04-30', false),
  (2026, DATE '2026-01-03', DATE '2026-04-30',
    CURRENT_DATE BETWEEN DATE '2026-01-03' AND DATE '2026-04-30')
ON CONFLICT (year) DO NOTHING;

COMMENT ON TABLE sync_cursors IS
  'Worker-private HTTP validators and ingest progress. Never exposed to the app role.';
