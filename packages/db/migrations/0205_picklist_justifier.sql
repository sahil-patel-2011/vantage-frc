-- Pick-list auto-justifier & contradiction guard: persisted, source-cited rationale
-- per pick-list slot (pick_list_entries row), plus a contradiction flag when the
-- justification leans on scouting that this org's own TBA-sourced match record
-- (team_event_metrics) contradicts. One row per pick_list_entries id; regenerated
-- (upserted) by the metered "generate" action.

CREATE TABLE picklist_justifier_justifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pick_list_id uuid NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
  pick_list_entry_id uuid NOT NULL REFERENCES pick_list_entries(id) ON DELETE CASCADE,
  team_key text NOT NULL REFERENCES teams_ref(team_key),
  rationale text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]',
  contradiction_flagged boolean NOT NULL DEFAULT false,
  contradiction_reason text,
  ai_request_id text,
  generated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pick_list_entry_id)
);
CREATE INDEX picklist_justifier_justifications_org_list_idx
  ON picklist_justifier_justifications(org_id, pick_list_id);

ALTER TABLE picklist_justifier_justifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY picklist_justifier_justifications_member_read ON picklist_justifier_justifications FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY picklist_justifier_justifications_member_insert ON picklist_justifier_justifications FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND generated_by = current_app_user_id());
CREATE POLICY picklist_justifier_justifications_member_update ON picklist_justifier_justifications FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY picklist_justifier_justifications_member_delete ON picklist_justifier_justifications FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON picklist_justifier_justifications TO vantage_app, vantage_worker;
