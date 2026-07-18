-- Prototype-to-decision tracker (Build pillar).
-- Log a prototype test (hypothesis, result, metric vs. target) and link it to the design
-- decision it informed. Drafting the decision record + notebook entry is a deterministic,
-- metered computation grounded only in the linked test's own recorded data — never fabricated.
-- Self-contained: does not reference or alter the existing engineering_notebook tables.

CREATE TABLE prototype_tracker_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem_name text NOT NULL,
  title text NOT NULL,
  hypothesis text NOT NULL DEFAULT '',
  test_date date NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'inconclusive', 'partial')),
  result_summary text NOT NULL DEFAULT '',
  metric_label text,
  metric_value numeric(12, 3),
  metric_target numeric(12, 3),
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prototype_tracker_tests_org_season_idx
  ON prototype_tracker_tests(org_id, season_year, test_date DESC);
CREATE INDEX prototype_tracker_tests_org_subsystem_idx
  ON prototype_tracker_tests(org_id, subsystem_name);

ALTER TABLE prototype_tracker_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY prototype_tracker_tests_member_read ON prototype_tracker_tests FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY prototype_tracker_tests_member_insert ON prototype_tracker_tests FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY prototype_tracker_tests_member_update ON prototype_tracker_tests FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY prototype_tracker_tests_member_delete ON prototype_tracker_tests FOR DELETE TO vantage_app
  USING (
    logged_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON prototype_tracker_tests TO vantage_app, vantage_worker;

CREATE TABLE prototype_tracker_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES prototype_tracker_tests(id) ON DELETE CASCADE,
  decision_title text NOT NULL,
  recommendation text NOT NULL CHECK (recommendation IN ('adopt', 'iterate', 'reject', 'needs_more_data')),
  confidence numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  decision_record text NOT NULL DEFAULT '',
  notebook_entry text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prototype_tracker_decisions_org_test_idx
  ON prototype_tracker_decisions(org_id, test_id, created_at DESC);

ALTER TABLE prototype_tracker_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY prototype_tracker_decisions_member_read ON prototype_tracker_decisions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY prototype_tracker_decisions_member_insert ON prototype_tracker_decisions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY prototype_tracker_decisions_member_update ON prototype_tracker_decisions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY prototype_tracker_decisions_member_delete ON prototype_tracker_decisions FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON prototype_tracker_decisions TO vantage_app, vantage_worker;
