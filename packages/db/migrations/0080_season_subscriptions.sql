-- Season subscriptions: recurring costs a team pays (CAD licenses, hosting, the Vantage plan,
-- other software). Combined with season_costs (real-world purchases) and the app's own
-- ai_usage_events (AI/API usage) to show the all-in cost of the season. Org-scoped, RLS.

CREATE TABLE season_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  name text NOT NULL,
  provider text,
  amount_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_usd >= 0),
  cadence text NOT NULL DEFAULT 'monthly' CHECK (cadence IN ('monthly','annual','one_time')),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX season_subscriptions_org_season_idx ON season_subscriptions(org_id, season_year);

ALTER TABLE season_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY season_subscriptions_member_read ON season_subscriptions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY season_subscriptions_member_insert ON season_subscriptions FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY season_subscriptions_member_update ON season_subscriptions FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY season_subscriptions_member_delete ON season_subscriptions FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON season_subscriptions TO vantage_app, vantage_worker;
