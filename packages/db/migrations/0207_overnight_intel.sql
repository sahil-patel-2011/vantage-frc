-- Overnight event-intel brief: a cron-compiled morning "what changed" digest for the org's
-- active event — newest research findings, EPA movement, and new scouting since the last brief.
-- Distinct from 0004 `research_findings` (raw findings) and `team_event_metrics` (raw EPA cache):
-- this stores the org-scoped generated briefs plus a rolling EPA snapshot history so the next
-- overnight run can diff "yesterday's EPA" against "today's EPA" per team.

CREATE TABLE overnight_intel_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  season_year integer NOT NULL,
  brief_date date NOT NULL,
  summary text NOT NULL,
  research_highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  epa_movers jsonb NOT NULL DEFAULT '[]'::jsonb,
  scouting_highlights jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_run_cost_usd double precision NOT NULL DEFAULT 0 CHECK (ai_run_cost_usd >= 0),
  generated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key, brief_date)
);
CREATE INDEX overnight_intel_briefs_org_event_idx
  ON overnight_intel_briefs(org_id, event_key, brief_date DESC);

CREATE TABLE overnight_intel_epa_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL REFERENCES events_ref(event_key),
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  epa_total double precision,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX overnight_intel_epa_snapshots_org_event_team_idx
  ON overnight_intel_epa_snapshots(org_id, event_key, team_key, captured_at DESC);

ALTER TABLE overnight_intel_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE overnight_intel_epa_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY overnight_intel_briefs_member_read ON overnight_intel_briefs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY overnight_intel_briefs_member_insert ON overnight_intel_briefs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND generated_by = current_app_user_id());
CREATE POLICY overnight_intel_briefs_member_update ON overnight_intel_briefs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY overnight_intel_briefs_member_delete ON overnight_intel_briefs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY overnight_intel_epa_snapshots_member_read ON overnight_intel_epa_snapshots FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY overnight_intel_epa_snapshots_member_insert ON overnight_intel_epa_snapshots FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));
CREATE POLICY overnight_intel_epa_snapshots_member_update ON overnight_intel_epa_snapshots FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY overnight_intel_epa_snapshots_member_delete ON overnight_intel_epa_snapshots FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON overnight_intel_briefs TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON overnight_intel_epa_snapshots TO vantage_app, vantage_worker;
