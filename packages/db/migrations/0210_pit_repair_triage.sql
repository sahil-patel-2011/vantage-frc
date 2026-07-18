-- Predictive pit-repair triage (CD Competition pillar).
-- Log a pit failure (note/photo), cross-reference FMEA failure history + spares
-- inventory + remaining match time, and record the deterministic fix-vs-swap
-- triage decision so the pit crew can pre-stage the right part. Read-only joins
-- against the existing fmea_failures / inventory_items tables — no new FMEA or
-- inventory schema is introduced here.

CREATE TABLE pit_repair_triage_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem_name text NOT NULL,
  title text NOT NULL,
  symptom_note text NOT NULL DEFAULT '',
  photo_url text,
  related_fmea_failure_id uuid REFERENCES fmea_failures(id) ON DELETE SET NULL,
  matched_inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
  minutes_until_next_match integer NOT NULL DEFAULT 0 CHECK (minutes_until_next_match >= 0),
  severity integer NOT NULL DEFAULT 5 CHECK (severity BETWEEN 1 AND 10),
  prior_failure_count integer NOT NULL DEFAULT 0 CHECK (prior_failure_count >= 0),
  spares_available numeric(12, 2) NOT NULL DEFAULT 0 CHECK (spares_available >= 0),
  decision text NOT NULL CHECK (decision IN ('fix', 'swap', 'monitor')),
  confidence numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  rationale text NOT NULL DEFAULT '',
  prestage_recommended boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'staged', 'resolved')),
  recorded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pit_repair_triage_reports_org_season_idx
  ON pit_repair_triage_reports(org_id, season_year, created_at DESC);
CREATE INDEX pit_repair_triage_reports_org_subsystem_idx
  ON pit_repair_triage_reports(org_id, subsystem_name);

ALTER TABLE pit_repair_triage_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY pit_repair_triage_reports_member_read ON pit_repair_triage_reports FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY pit_repair_triage_reports_member_insert ON pit_repair_triage_reports FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND recorded_by = current_app_user_id());
CREATE POLICY pit_repair_triage_reports_member_update ON pit_repair_triage_reports FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY pit_repair_triage_reports_member_delete ON pit_repair_triage_reports FOR DELETE TO vantage_app
  USING (
    recorded_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON pit_repair_triage_reports TO vantage_app, vantage_worker;
