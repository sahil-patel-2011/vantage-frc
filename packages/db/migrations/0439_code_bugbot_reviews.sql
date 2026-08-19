-- AI Bugbot reviews: grounded findings for pasted / GitHub robot source.
-- Does not store raw source (hash + path + findings only). Never DEMO reviews.

CREATE TABLE code_bugbot_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  path text NOT NULL,
  content_sha256 text NOT NULL,
  provider text,
  model text,
  risk_level text NOT NULL CHECK (risk_level IN ('high','medium','low')),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  local_risk_count integer NOT NULL DEFAULT 0 CHECK (local_risk_count >= 0),
  model_finding_count integer NOT NULL DEFAULT 0 CHECK (model_finding_count >= 0),
  dropped_ungrounded integer NOT NULL DEFAULT 0 CHECK (dropped_ungrounded >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX code_bugbot_reviews_org_created_idx
  ON code_bugbot_reviews (org_id, created_at DESC);

ALTER TABLE code_bugbot_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY code_bugbot_reviews_member_read ON code_bugbot_reviews
  FOR SELECT TO vantage_app USING (is_org_member(org_id));
CREATE POLICY code_bugbot_reviews_member_insert ON code_bugbot_reviews
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

GRANT SELECT, INSERT ON code_bugbot_reviews TO vantage_app, vantage_worker;
