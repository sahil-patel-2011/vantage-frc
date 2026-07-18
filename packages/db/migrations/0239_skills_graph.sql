-- Skills/mentorship graph: members self-declare demonstrated skills (with an evidence note),
-- reinforced by real completed-task activity from the Build task board, and novices can request
-- a mentor for a skill category — matched by a deterministic local computation, never invented.

CREATE TABLE skills_graph_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_category text NOT NULL DEFAULT 'other'
    CHECK (skill_category IN (
      'drivetrain','intake','shooter','arm','elevator','climber','turret','indexer',
      'software','electrical','mechanical_design','strategy','outreach','other'
    )),
  custom_label text,
  proficiency text NOT NULL DEFAULT 'developing'
    CHECK (proficiency IN ('novice','developing','proficient','expert')),
  evidence_note text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX skills_graph_entries_org_category_idx ON skills_graph_entries(org_id, skill_category);
CREATE INDEX skills_graph_entries_org_user_idx ON skills_graph_entries(org_id, user_id);

ALTER TABLE skills_graph_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY skills_graph_entries_member_read ON skills_graph_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY skills_graph_entries_member_insert ON skills_graph_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY skills_graph_entries_member_update ON skills_graph_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY skills_graph_entries_member_delete ON skills_graph_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON skills_graph_entries TO vantage_app, vantage_worker;

CREATE TABLE skills_graph_mentor_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requester_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_category text NOT NULL DEFAULT 'other'
    CHECK (skill_category IN (
      'drivetrain','intake','shooter','arm','elevator','climber','turret','indexer',
      'software','electrical','mechanical_design','strategy','outreach','other'
    )),
  note text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','closed')),
  matched_user_id uuid REFERENCES users(id),
  matched_rationale text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX skills_graph_mentor_requests_org_status_idx ON skills_graph_mentor_requests(org_id, status);

ALTER TABLE skills_graph_mentor_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY skills_graph_mentor_requests_member_read ON skills_graph_mentor_requests FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY skills_graph_mentor_requests_member_insert ON skills_graph_mentor_requests FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY skills_graph_mentor_requests_member_update ON skills_graph_mentor_requests FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY skills_graph_mentor_requests_member_delete ON skills_graph_mentor_requests FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON skills_graph_mentor_requests TO vantage_app, vantage_worker;
