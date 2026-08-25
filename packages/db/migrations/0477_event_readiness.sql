-- Event Readiness: ONE dated pre-event countdown per event, rolling up the four
-- systems that already own the underlying data — robot inspection (0054/0233),
-- consent forms (0067), packing lists (0055/0437), and event logistics/travel
-- (0181) — plus the manual/template checklist rows none of them hold.
--
-- Boundary: this is the BEFORE-the-event countdown (absolute due dates or
-- days-before offsets from event_start_date). It is NOT the hour-by-hour
-- DURING-event schedule — that stays in event_day_plan_blocks and
-- apps/web/lib/event-day-plan. Source-backed rows here never copy source data
-- (no consent/medical detail is ever stored); the roll-up reads live counts at
-- request time and links out to the owning tool.

CREATE TABLE event_readiness_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_key text NOT NULL CHECK (char_length(event_key) BETWEEN 1 AND 80),
  season_year integer,
  event_name text NOT NULL DEFAULT '',
  event_start_date date NOT NULL,
  travel_departs_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event_key)
);
CREATE INDEX event_readiness_plans_org_idx ON event_readiness_plans(org_id, event_start_date);

CREATE TABLE event_readiness_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES event_readiness_plans(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('robot','inspection','consent','roster','packing','travel','money','pit','other')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
  detail text NOT NULL DEFAULT '',
  -- Either an absolute due date OR an offset in days before event_start_date.
  -- Rows with neither are honest "no date" rows and never get a defaulted date.
  due_on date,
  days_before integer CHECK (days_before >= 0 AND days_before <= 365),
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','done','blocked','not_applicable')),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  source_kind text NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual','template','inspection','consent','packing','logistics')),
  source_id uuid,
  blocked_reason text NOT NULL DEFAULT '',
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_readiness_items_plan_idx ON event_readiness_items(org_id, plan_id, due_on);

ALTER TABLE event_readiness_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_readiness_items ENABLE ROW LEVEL SECURITY;

-- Readiness is a whole-team activity: members read and update; inserts stamp the
-- author; destructive deletes are limited to the row's author or an owner/admin.
CREATE POLICY event_readiness_plans_read ON event_readiness_plans FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY event_readiness_plans_insert ON event_readiness_plans FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY event_readiness_plans_update ON event_readiness_plans FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY event_readiness_plans_delete ON event_readiness_plans FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

CREATE POLICY event_readiness_items_read ON event_readiness_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY event_readiness_items_insert ON event_readiness_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY event_readiness_items_update ON event_readiness_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY event_readiness_items_delete ON event_readiness_items FOR DELETE TO vantage_app
  USING (created_by = current_app_user_id() OR has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON event_readiness_plans, event_readiness_items TO vantage_app, vantage_worker;
