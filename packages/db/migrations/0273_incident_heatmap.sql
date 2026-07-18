-- Incident heatmap: a lightweight subsystem/time incident log distinct from the FMEA
-- root-cause record (0153) and pit-repair-triage decisions (0210). This is the raw event
-- log ("what broke, where, when") that the heatmap aggregates by subsystem x time bucket
-- to spot hotspots — no severity scoring or triage workflow, just the incident trail.

CREATE TABLE incident_heatmap_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem text NOT NULL,
  context text NOT NULL DEFAULT 'pit'
    CHECK (context IN ('match', 'pit', 'practice', 'inspection', 'other')),
  event_key text,
  match_key text,
  title text NOT NULL,
  notes text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX incident_heatmap_incidents_org_season_idx
  ON incident_heatmap_incidents(org_id, season_year, occurred_at DESC);
CREATE INDEX incident_heatmap_incidents_org_subsystem_idx
  ON incident_heatmap_incidents(org_id, subsystem);

ALTER TABLE incident_heatmap_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY incident_heatmap_incidents_member_read ON incident_heatmap_incidents FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY incident_heatmap_incidents_member_insert ON incident_heatmap_incidents FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY incident_heatmap_incidents_member_update ON incident_heatmap_incidents FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY incident_heatmap_incidents_member_delete ON incident_heatmap_incidents FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON incident_heatmap_incidents TO vantage_app, vantage_worker;
