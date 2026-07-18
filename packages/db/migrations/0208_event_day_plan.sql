-- Event-day stress planner: a per-hour plan overlaying qual schedule, battery needs, scout
-- shifts, pit-repair windows, and logistics tasks, with time/assignee conflict detection.
-- Self-contained: blocks are logged directly by the team for a given competition event/day,
-- not joined against other features' tables (those may not exist for every org).

CREATE TABLE event_day_plan_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  plan_date date NOT NULL,
  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('qual_match','battery_charge','scout_shift','pit_repair','logistics','other')),
  title text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (end_at > start_at),
  assigned_to text,
  location text,
  notes text,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','in_progress','done','cancelled')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_day_plan_blocks_org_event_idx
  ON event_day_plan_blocks(org_id, event_key, plan_date, start_at);

ALTER TABLE event_day_plan_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY event_day_plan_blocks_member_read ON event_day_plan_blocks FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY event_day_plan_blocks_member_insert ON event_day_plan_blocks FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY event_day_plan_blocks_member_update ON event_day_plan_blocks FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY event_day_plan_blocks_member_delete ON event_day_plan_blocks FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON event_day_plan_blocks TO vantage_app, vantage_worker;
