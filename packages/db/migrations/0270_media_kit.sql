-- Media Kit: team media-kit generator grounded in real team data — logo/photo asset
-- library, an editable team-bio profile (mission, bio, achievements), and generated
-- one-pager documents built only from the recorded profile/assets/org record.

CREATE TABLE media_kit_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  mission_statement text,
  team_bio text,
  founded_year integer CHECK (founded_year IS NULL OR (founded_year BETWEEN 1900 AND 3000)),
  achievements text[] NOT NULL DEFAULT '{}',
  contact_email text,
  website_url text,
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, season_year)
);
CREATE INDEX media_kit_profiles_org_season_idx ON media_kit_profiles(org_id, season_year DESC);

ALTER TABLE media_kit_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_kit_profiles_member_read ON media_kit_profiles FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY media_kit_profiles_member_insert ON media_kit_profiles FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());
CREATE POLICY media_kit_profiles_member_update ON media_kit_profiles FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY media_kit_profiles_member_delete ON media_kit_profiles FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON media_kit_profiles TO vantage_app, vantage_worker;

CREATE TABLE media_kit_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'logo'
    CHECK (kind IN ('logo','photo','graphic','other')),
  title text NOT NULL,
  url text NOT NULL,
  description text,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_kit_assets_org_idx ON media_kit_assets(org_id, created_at DESC);

ALTER TABLE media_kit_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_kit_assets_member_read ON media_kit_assets FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY media_kit_assets_member_insert ON media_kit_assets FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND uploaded_by = current_app_user_id());
CREATE POLICY media_kit_assets_member_update ON media_kit_assets FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY media_kit_assets_member_delete ON media_kit_assets FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON media_kit_assets TO vantage_app, vantage_worker;

CREATE TABLE media_kit_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  title text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_kit_documents_org_season_idx ON media_kit_documents(org_id, season_year DESC, created_at DESC);

ALTER TABLE media_kit_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_kit_documents_member_read ON media_kit_documents FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY media_kit_documents_member_insert ON media_kit_documents FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY media_kit_documents_member_update ON media_kit_documents FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY media_kit_documents_member_delete ON media_kit_documents FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON media_kit_documents TO vantage_app, vantage_worker;
