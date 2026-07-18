-- Checklist Library: reusable checklist templates (pit setup, transport load-out,
-- competition load-in, etc.) that a team defines once and re-runs at every event.
-- Distinct from 0236 match_checklist (single fixed pre-match checklist run per match):
-- this is a general-purpose library of named, editable templates with arbitrary item
-- lists, each of which can be started as a run and checked off item-by-item.

CREATE TABLE checklist_library_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'pit'
    CHECK (category IN ('pit', 'transport', 'load_in', 'load_out', 'other')),
  description text,
  items jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checklist_library_templates_org_idx
  ON checklist_library_templates(org_id, active, created_at DESC);

ALTER TABLE checklist_library_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklist_library_templates_member_read ON checklist_library_templates FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY checklist_library_templates_member_insert ON checklist_library_templates FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY checklist_library_templates_member_update ON checklist_library_templates FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY checklist_library_templates_member_delete ON checklist_library_templates FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_library_templates TO vantage_app, vantage_worker;

-- A run is one execution of a template (e.g. "Load-in — Week 3 Regional"), tracking
-- which items have been checked off and when.
CREATE TABLE checklist_library_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES checklist_library_templates(id) ON DELETE CASCADE,
  label text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  checked_items jsonb NOT NULL DEFAULT '[]',
  started_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checklist_library_runs_org_idx
  ON checklist_library_runs(org_id, started_at DESC);
CREATE INDEX checklist_library_runs_template_idx
  ON checklist_library_runs(template_id);

ALTER TABLE checklist_library_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY checklist_library_runs_member_read ON checklist_library_runs FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY checklist_library_runs_member_insert ON checklist_library_runs FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND started_by = current_app_user_id());
CREATE POLICY checklist_library_runs_member_update ON checklist_library_runs FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY checklist_library_runs_member_delete ON checklist_library_runs FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON checklist_library_runs TO vantage_app, vantage_worker;
