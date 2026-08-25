-- Bug reports + beta program enrollments.
-- Bug reports are personal feedback (org context optional — a signed-in member may report from
-- outside any org context). Reporter sees their own rows; platform admins triage all of them
-- (mirrors the platform_admins-gated policy shape from 0220_product_releases.sql).
-- client_info stores only what the reporter is shown before submitting (viewport + user agent) —
-- no fingerprinting fields.

CREATE TABLE IF NOT EXISTS bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route text,
  description text NOT NULL,
  severity text CHECK (severity IN ('annoyance', 'blocking', 'data-loss')),
  app_area text,
  client_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'triaged', 'fixed', 'wont_fix')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bug_reports_description_len CHECK (char_length(btrim(description)) BETWEEN 1 AND 5000),
  CONSTRAINT bug_reports_route_len CHECK (route IS NULL OR char_length(route) <= 300),
  CONSTRAINT bug_reports_app_area_len CHECK (app_area IS NULL OR char_length(app_area) <= 120)
);

CREATE INDEX IF NOT EXISTS bug_reports_user_idx ON bug_reports (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_status_idx ON bug_reports (status, created_at DESC);

ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

-- Reporter: insert own rows (org context, when given, must be an org they belong to) and read them back.
DROP POLICY IF EXISTS bug_reports_self_insert ON bug_reports;
CREATE POLICY bug_reports_self_insert ON bug_reports FOR INSERT TO vantage_app
  WITH CHECK (
    user_id = current_app_user_id()
    AND (org_id IS NULL OR is_org_member(org_id))
  );

DROP POLICY IF EXISTS bug_reports_self_read ON bug_reports;
CREATE POLICY bug_reports_self_read ON bug_reports FOR SELECT TO vantage_app
  USING (user_id = current_app_user_id());

-- Platform admin: full triage access (read + status updates).
DROP POLICY IF EXISTS bug_reports_platform_admin ON bug_reports;
CREATE POLICY bug_reports_platform_admin ON bug_reports FOR ALL TO vantage_app
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON bug_reports TO vantage_app, vantage_worker;

-- Beta program: one row per enrolled user, self-managed.
CREATE TABLE IF NOT EXISTS beta_enrollments (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE beta_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS beta_enrollments_self ON beta_enrollments;
CREATE POLICY beta_enrollments_self ON beta_enrollments FOR ALL TO vantage_app
  USING (user_id = current_app_user_id())
  WITH CHECK (
    user_id = current_app_user_id()
    AND (org_id IS NULL OR is_org_member(org_id))
  );

DROP POLICY IF EXISTS beta_enrollments_platform_read ON beta_enrollments;
CREATE POLICY beta_enrollments_platform_read ON beta_enrollments FOR SELECT TO vantage_app
  USING (is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON beta_enrollments TO vantage_app, vantage_worker;
