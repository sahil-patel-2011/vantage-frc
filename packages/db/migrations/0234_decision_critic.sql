-- Decision Critic: an AI devil's-advocate second opinion on a design decision, grounded in
-- read-only joins against this org's FMEA failure history (fmea_failures), weight budget
-- (weight_components / weight_settings), and power budget (power_loads), plus a keyword match
-- against prior decision outcomes (decision_records). The critique itself (verdict, concerns,
-- confidence) is computed deterministically from those grounded numbers and persisted here so
-- the team can record what actually happened (outcome) and build a track record over time.

CREATE TABLE decision_critic_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  subsystem_name text NOT NULL,
  title text NOT NULL,
  proposal text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'design'
    CHECK (category IN ('design', 'strategy', 'build', 'process', 'other')),
  weight_added_lbs numeric(7, 2) NOT NULL DEFAULT 0 CHECK (weight_added_lbs >= 0),
  weight_margin_lbs numeric(7, 2) NOT NULL DEFAULT 0,
  power_added_amps numeric(7, 2) NOT NULL DEFAULT 0 CHECK (power_added_amps >= 0),
  power_headroom_amps numeric(7, 2) NOT NULL DEFAULT 0,
  chronic_failure_count integer NOT NULL DEFAULT 0 CHECK (chronic_failure_count >= 0),
  prior_rejected_count integer NOT NULL DEFAULT 0 CHECK (prior_rejected_count >= 0),
  verdict text NOT NULL CHECK (verdict IN ('proceed', 'proceed_with_caution', 'reconsider')),
  confidence numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  concerns text[] NOT NULL DEFAULT '{}',
  recommendation text NOT NULL DEFAULT '',
  related_fmea_failure_ids text[] NOT NULL DEFAULT '{}',
  related_decision_ids text[] NOT NULL DEFAULT '{}',
  outcome text NOT NULL DEFAULT 'open'
    CHECK (outcome IN ('open', 'proceeded', 'revised', 'abandoned')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX decision_critic_reviews_org_season_idx
  ON decision_critic_reviews(org_id, season_year, created_at DESC);
CREATE INDEX decision_critic_reviews_org_subsystem_idx
  ON decision_critic_reviews(org_id, subsystem_name);

ALTER TABLE decision_critic_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY decision_critic_reviews_member_read ON decision_critic_reviews FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY decision_critic_reviews_member_insert ON decision_critic_reviews FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY decision_critic_reviews_member_update ON decision_critic_reviews FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY decision_critic_reviews_member_delete ON decision_critic_reviews FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON decision_critic_reviews TO vantage_app, vantage_worker;
