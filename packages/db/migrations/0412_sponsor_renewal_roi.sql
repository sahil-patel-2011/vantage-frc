-- Sponsor Renewal-Risk Score & Auto ROI Report: a scoring snapshot computed from existing
-- sponsors-CRM interaction timestamps (0035 sponsor_interactions/sponsor_contributions),
-- community-impact mentions (0038 impact_activities), and outreach-evidence-vault entries
-- (0348 outreach_evidence_vault_items) tied to a sponsor, plus AI-assisted (meteredAI,
-- feature=sponsor_renewal_roi) one-page ROI reports assembled from the same cross-feature data.
-- Distinct from 0283 sponsor_tier_calculator (giving-threshold benefits) and 0295 sponsor_wall
-- (public recognition wall) -- this is the private churn-risk + ROI reporting surface.

CREATE TABLE sponsor_renewal_roi_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  risk_score numeric(5,4) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
  risk_tier text NOT NULL CHECK (risk_tier IN ('low', 'moderate', 'high')),
  components jsonb NOT NULL DEFAULT '{}',
  season_year integer NOT NULL,
  computed_by uuid NOT NULL REFERENCES users(id),
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_renewal_roi_scores_org_sponsor_idx
  ON sponsor_renewal_roi_scores(org_id, sponsor_id, computed_at DESC);
CREATE INDEX sponsor_renewal_roi_scores_org_season_idx
  ON sponsor_renewal_roi_scores(org_id, season_year, computed_at DESC);

CREATE TABLE sponsor_renewal_roi_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  score_id uuid REFERENCES sponsor_renewal_roi_scores(id) ON DELETE SET NULL,
  season_year integer NOT NULL,
  title text NOT NULL,
  risk_score numeric(5,4),
  sections jsonb NOT NULL DEFAULT '[]',
  html_content text NOT NULL,
  ai_run_metadata jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_renewal_roi_reports_org_sponsor_idx
  ON sponsor_renewal_roi_reports(org_id, sponsor_id, created_at DESC);

ALTER TABLE sponsor_renewal_roi_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_renewal_roi_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY sponsor_renewal_roi_scores_member_read ON sponsor_renewal_roi_scores FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_renewal_roi_scores_member_insert ON sponsor_renewal_roi_scores FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND computed_by = current_app_user_id());
CREATE POLICY sponsor_renewal_roi_scores_member_update ON sponsor_renewal_roi_scores FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_renewal_roi_scores_member_delete ON sponsor_renewal_roi_scores FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY sponsor_renewal_roi_reports_member_read ON sponsor_renewal_roi_reports FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_renewal_roi_reports_member_insert ON sponsor_renewal_roi_reports FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY sponsor_renewal_roi_reports_member_update ON sponsor_renewal_roi_reports FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_renewal_roi_reports_member_delete ON sponsor_renewal_roi_reports FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON sponsor_renewal_roi_scores, sponsor_renewal_roi_reports
  TO vantage_app, vantage_worker;
