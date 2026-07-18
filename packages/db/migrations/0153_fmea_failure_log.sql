-- Structured FMEA / failure log (CD #41).
-- Capture in-match and pit failures against a subsystem with occurrence /
-- severity / detection scores, root cause, and fix. Optional links to
-- robot_subsystems and inspection_items. RPN is computed in the app.

CREATE TABLE IF NOT EXISTS fmea_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  robot_label text NOT NULL DEFAULT 'competition',
  subsystem_id uuid REFERENCES robot_subsystems(id) ON DELETE SET NULL,
  subsystem_name text NOT NULL,
  title text NOT NULL,
  failure_mode text NOT NULL DEFAULT '',
  context text NOT NULL DEFAULT 'pit'
    CHECK (context IN ('match', 'pit', 'practice', 'inspection', 'other')),
  event_key text,
  match_key text,
  occurrence integer NOT NULL DEFAULT 3 CHECK (occurrence BETWEEN 1 AND 10),
  severity integer NOT NULL DEFAULT 3 CHECK (severity BETWEEN 1 AND 10),
  detection integer NOT NULL DEFAULT 3 CHECK (detection BETWEEN 1 AND 10),
  root_cause text,
  five_whys text,
  fix text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'fixing', 'verified', 'closed')),
  inspection_item_id uuid REFERENCES inspection_items(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fmea_failures_org_season_idx
  ON fmea_failures(org_id, season_year, occurred_at DESC);
CREATE INDEX IF NOT EXISTS fmea_failures_org_subsystem_idx
  ON fmea_failures(org_id, subsystem_name);
CREATE INDEX IF NOT EXISTS fmea_failures_org_rpn_idx
  ON fmea_failures(org_id, season_year, (occurrence * severity * detection) DESC);

ALTER TABLE fmea_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fmea_failures_read ON fmea_failures;
DROP POLICY IF EXISTS fmea_failures_insert ON fmea_failures;
DROP POLICY IF EXISTS fmea_failures_update ON fmea_failures;
DROP POLICY IF EXISTS fmea_failures_delete ON fmea_failures;

CREATE POLICY fmea_failures_read ON fmea_failures FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY fmea_failures_insert ON fmea_failures FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
CREATE POLICY fmea_failures_update ON fmea_failures FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY fmea_failures_delete ON fmea_failures FOR DELETE TO vantage_app
  USING (
    recorded_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON fmea_failures TO vantage_app, vantage_worker;
