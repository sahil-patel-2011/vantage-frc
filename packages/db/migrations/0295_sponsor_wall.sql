-- Sponsor Wall: a public-facing sponsor thank-you wall generator. Distinct from 0036 sponsor
-- outreach and the sponsor-suite CRM tables: this is the curated, publishable list of sponsor
-- shout-outs (name, tier, logo, message) plus the wall's display settings (headline, theme).

CREATE TABLE sponsor_wall_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sponsor_name text NOT NULL,
  tier text NOT NULL DEFAULT 'partner'
    CHECK (tier IN ('title','platinum','gold','silver','bronze','inkind','partner')),
  logo_url text,
  website_url text,
  message text,
  display_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_wall_entries_org_order_idx ON sponsor_wall_entries(org_id, display_order, created_at DESC);

ALTER TABLE sponsor_wall_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY sponsor_wall_entries_member_read ON sponsor_wall_entries FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_wall_entries_member_insert ON sponsor_wall_entries FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY sponsor_wall_entries_member_update ON sponsor_wall_entries FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_wall_entries_member_delete ON sponsor_wall_entries FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON sponsor_wall_entries TO vantage_app, vantage_worker;

-- One settings row per org: the wall's headline/subtitle/theme and whether it is published.
CREATE TABLE sponsor_wall_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  headline text NOT NULL DEFAULT 'Thank You to Our Sponsors',
  subtitle text,
  theme text NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark','team')),
  published boolean NOT NULL DEFAULT false,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sponsor_wall_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY sponsor_wall_settings_member_read ON sponsor_wall_settings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_wall_settings_member_insert ON sponsor_wall_settings FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());
CREATE POLICY sponsor_wall_settings_member_update ON sponsor_wall_settings FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY sponsor_wall_settings_member_delete ON sponsor_wall_settings FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON sponsor_wall_settings TO vantage_app, vantage_worker;
