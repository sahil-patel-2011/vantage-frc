-- Design Reviews: gate reviews for a subsystem (concept / preliminary / critical / final) with
-- a criteria checklist stored as jsonb items, each with a verdict and a go/no-go blocker flag.
-- The app derives readiness and the gate decision. Org-scoped, collaborative, per-org RLS.

CREATE TABLE design_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL,
  subsystem text NOT NULL DEFAULT 'general',
  stage text NOT NULL DEFAULT 'critical'
    CHECK (stage IN ('concept','preliminary','critical','final')),
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','in_review','complete','cancelled')),
  scheduled_on date,
  reviewers text,
  items jsonb NOT NULL DEFAULT '[]',
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX design_reviews_org_season_idx ON design_reviews(org_id, season_year, scheduled_on DESC);

ALTER TABLE design_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY design_reviews_member_read ON design_reviews FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY design_reviews_member_insert ON design_reviews FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY design_reviews_member_update ON design_reviews FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY design_reviews_member_delete ON design_reviews FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON design_reviews TO vantage_app, vantage_worker;
