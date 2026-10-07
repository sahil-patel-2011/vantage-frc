-- A correction keeps the original observation's author, robot and questions.
-- Application callers can update only answers and observation time, never its identity.
CREATE POLICY free_scout_author_update ON free_scout_reports FOR UPDATE TO vantage_app
  USING (is_org_member(org_id) AND scout_user_id = current_app_user_id())
  WITH CHECK (is_org_member(org_id) AND scout_user_id = current_app_user_id());
GRANT UPDATE (payload, observed_at) ON free_scout_reports TO vantage_app;
