-- Meeting-agenda autopilot: builds a team-meeting agenda from open blockers (build_tasks),
-- overdue tasks (build_tasks), unresolved decisions (decision_records), and open FMEA
-- (fmea_failures) — all existing tables, read-only joins. Only the generated agenda snapshot
-- and the action items drafted from the follow-up minutes are new schema, prefixed with the
-- feature slug. Org-scoped, collaborative, per-org RLS.

CREATE TABLE meeting_autopilot_agendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL,
  meeting_on date,
  agenda_items jsonb NOT NULL DEFAULT '[]',
  blocker_count integer NOT NULL DEFAULT 0 CHECK (blocker_count >= 0),
  overdue_task_count integer NOT NULL DEFAULT 0 CHECK (overdue_task_count >= 0),
  decision_count integer NOT NULL DEFAULT 0 CHECK (decision_count >= 0),
  fmea_count integer NOT NULL DEFAULT 0 CHECK (fmea_count >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_autopilot_agendas_org_season_idx
  ON meeting_autopilot_agendas(org_id, season_year, created_at DESC);

ALTER TABLE meeting_autopilot_agendas ENABLE ROW LEVEL SECURITY;

CREATE POLICY meeting_autopilot_agendas_member_read ON meeting_autopilot_agendas FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY meeting_autopilot_agendas_member_insert ON meeting_autopilot_agendas FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY meeting_autopilot_agendas_member_update ON meeting_autopilot_agendas FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY meeting_autopilot_agendas_member_delete ON meeting_autopilot_agendas FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_autopilot_agendas TO vantage_app, vantage_worker;

-- Action items drafted (deterministically parsed) from post-meeting minutes text, linked back
-- to the agenda that generated the meeting.
CREATE TABLE meeting_autopilot_action_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agenda_id uuid NOT NULL REFERENCES meeting_autopilot_agendas(id) ON DELETE CASCADE,
  title text NOT NULL,
  owner text,
  due_on date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  source_excerpt text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_autopilot_action_items_org_agenda_idx
  ON meeting_autopilot_action_items(org_id, agenda_id, created_at DESC);

ALTER TABLE meeting_autopilot_action_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY meeting_autopilot_action_items_member_read ON meeting_autopilot_action_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY meeting_autopilot_action_items_member_insert ON meeting_autopilot_action_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY meeting_autopilot_action_items_member_update ON meeting_autopilot_action_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY meeting_autopilot_action_items_member_delete ON meeting_autopilot_action_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON meeting_autopilot_action_items TO vantage_app, vantage_worker;
