-- Leadership Continuity: succession planning + role-handoff board. Tracks each named
-- leadership/technical role's current holder, the identified successor (if any), and the
-- handoff status between them (not_started -> identified -> in_training -> ready -> completed).
-- Distinct from 0240 bus-factor workload entries (task/skill concentration risk) — this is the
-- explicit, named succession record teams use for officer transitions and mentor handoffs.

CREATE TABLE leadership_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_title text NOT NULL,
  category text NOT NULL DEFAULT 'leadership'
    CHECK (category IN ('leadership','technical','mentor','business','safety','other')),
  holder_name text NOT NULL,
  holder_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  successor_name text,
  successor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  handoff_status text NOT NULL DEFAULT 'not_started'
    CHECK (handoff_status IN ('not_started','identified','in_training','ready','completed')),
  target_handoff_date date,
  notes text,
  season_year integer NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leadership_roles_org_season_idx ON leadership_roles(org_id, season_year, role_title);

ALTER TABLE leadership_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY leadership_roles_member_read ON leadership_roles FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY leadership_roles_member_insert ON leadership_roles FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY leadership_roles_member_update ON leadership_roles FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY leadership_roles_member_delete ON leadership_roles FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON leadership_roles TO vantage_app, vantage_worker;
