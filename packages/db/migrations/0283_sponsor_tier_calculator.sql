-- Sponsor tier/benefit calculator & recognition planner. Org-defined tier thresholds (giving
-- level -> benefits) plus a per-season benefit-fulfillment checklist per sponsor. Reads the
-- existing `sponsors` / `sponsor_contributions` tables (0035) to compute actual giving; this
-- migration only adds the tier-definition and fulfillment-tracking tables.

CREATE TABLE sponsor_tier_calculator_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  min_amount_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (min_amount_usd >= 0),
  benefits text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX sponsor_tier_calculator_tiers_org_idx
  ON sponsor_tier_calculator_tiers(org_id, min_amount_usd DESC);

ALTER TABLE sponsor_tier_calculator_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY sponsor_tier_calculator_tiers_member_read ON sponsor_tier_calculator_tiers FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_tier_calculator_tiers_member_insert ON sponsor_tier_calculator_tiers FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY sponsor_tier_calculator_tiers_member_update ON sponsor_tier_calculator_tiers FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_tier_calculator_tiers_member_delete ON sponsor_tier_calculator_tiers FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON sponsor_tier_calculator_tiers TO vantage_app, vantage_worker;

CREATE TABLE sponsor_tier_calculator_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  benefit text NOT NULL,
  fulfilled boolean NOT NULL DEFAULT false,
  fulfilled_at timestamptz,
  notes text,
  logged_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, season_year, benefit)
);
CREATE INDEX sponsor_tier_calculator_fulfillments_org_season_idx
  ON sponsor_tier_calculator_fulfillments(org_id, season_year);
CREATE INDEX sponsor_tier_calculator_fulfillments_sponsor_idx
  ON sponsor_tier_calculator_fulfillments(sponsor_id, season_year);

ALTER TABLE sponsor_tier_calculator_fulfillments ENABLE ROW LEVEL SECURITY;

CREATE POLICY sponsor_tier_calculator_fulfillments_member_read ON sponsor_tier_calculator_fulfillments FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_tier_calculator_fulfillments_member_insert ON sponsor_tier_calculator_fulfillments FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND logged_by = current_app_user_id());
CREATE POLICY sponsor_tier_calculator_fulfillments_member_update ON sponsor_tier_calculator_fulfillments FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_tier_calculator_fulfillments_member_delete ON sponsor_tier_calculator_fulfillments FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON sponsor_tier_calculator_fulfillments TO vantage_app, vantage_worker;
