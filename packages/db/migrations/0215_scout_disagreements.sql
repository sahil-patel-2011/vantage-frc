-- Scout Disagreements: lead-facing queue of conflicting scouted field values (e.g. two scouts
-- logging different auto-mobility results for the same match/team/field) with resolve/override
-- and an immutable audit trail of every resolution action. Self-contained: leads log a conflict
-- with the competing values, then resolve it; every state change is appended to the audit log.

CREATE TABLE scout_disagreements_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  event_key text,
  match_number integer NOT NULL CHECK (match_number > 0),
  team_number integer NOT NULL CHECK (team_number > 0),
  field_key text NOT NULL,
  field_label text NOT NULL,
  values jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_value text,
  resolution_note text,
  resolved_by uuid REFERENCES users(id),
  resolved_at timestamptz,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scout_disagreements_items_org_season_idx
  ON scout_disagreements_items(org_id, season_year, status, created_at DESC);

ALTER TABLE scout_disagreements_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_disagreements_items_member_read ON scout_disagreements_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_disagreements_items_member_insert ON scout_disagreements_items FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY scout_disagreements_items_member_update ON scout_disagreements_items FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_disagreements_items_member_delete ON scout_disagreements_items FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_disagreements_items TO vantage_app, vantage_worker;

-- Immutable audit trail: one row per state-changing action (logged / resolved / dismissed /
-- reopened). Application code only ever inserts and reads; update/delete privileges are granted
-- for schema-pattern consistency but are not exercised by product code.
CREATE TABLE scout_disagreements_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  disagreement_id uuid NOT NULL REFERENCES scout_disagreements_items(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('logged', 'resolved', 'dismissed', 'reopened')),
  previous_status text,
  new_status text,
  resolved_value text,
  note text,
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scout_disagreements_audit_log_org_disagreement_idx
  ON scout_disagreements_audit_log(org_id, disagreement_id, created_at DESC);

ALTER TABLE scout_disagreements_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_disagreements_audit_log_member_read ON scout_disagreements_audit_log FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_disagreements_audit_log_member_insert ON scout_disagreements_audit_log FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND actor_id = current_app_user_id());
CREATE POLICY scout_disagreements_audit_log_member_update ON scout_disagreements_audit_log FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY scout_disagreements_audit_log_member_delete ON scout_disagreements_audit_log FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON scout_disagreements_audit_log TO vantage_app, vantage_worker;
