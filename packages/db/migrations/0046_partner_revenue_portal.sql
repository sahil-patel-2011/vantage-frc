-- Team-controlled sponsor storefront, paid placements, and a sanitized artwork
-- library. Payments go directly to the team's configured provider; Vantage
-- records the relationship and ledger entry but never holds team funds.

CREATE TABLE partner_program_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  storefront_enabled boolean NOT NULL DEFAULT false,
  payment_url text,
  pitch text,
  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payment_url IS NULL OR payment_url ~ '^https?://')
);

CREATE TABLE partner_placement_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  price_usd numeric(12,2) NOT NULL CHECK (price_usd >= 0),
  duration_days integer NOT NULL DEFAULT 30 CHECK (duration_days BETWEEN 1 AND 730),
  surfaces text[] NOT NULL DEFAULT ARRAY['business_wall']::text[],
  benefits text,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name),
  CHECK (surfaces <@ ARRAY['dashboard_footer','pit_footer','business_wall']::text[])
);

CREATE TABLE sponsor_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  media_type text NOT NULL DEFAULT 'image/png' CHECK (media_type = 'image/png'),
  bytes bytea NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 1048576),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 800),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 400),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','archived')),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, checksum_sha256)
);
CREATE INDEX sponsor_assets_org_status_idx ON sponsor_assets(org_id, status, created_at DESC);

CREATE TABLE partner_storefront_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  package_id uuid REFERENCES partner_placement_packages(id) ON DELETE SET NULL,
  company_name text NOT NULL CHECK (char_length(company_name) BETWEEN 1 AND 160),
  contact_name text NOT NULL CHECK (char_length(contact_name) BETWEEN 1 AND 160),
  contact_email text NOT NULL CHECK (char_length(contact_email) BETWEEN 3 AND 320),
  website text,
  headline text,
  message text,
  external_logo_url text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (website IS NULL OR website ~ '^https?://'),
  CHECK (external_logo_url IS NULL OR external_logo_url ~ '^https?://')
);
CREATE INDEX partner_storefront_submissions_org_status_idx
  ON partner_storefront_submissions(org_id, status, created_at DESC);

CREATE TABLE partner_placement_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sponsor_id uuid NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,
  package_id uuid REFERENCES partner_placement_packages(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES sponsor_assets(id) ON DELETE SET NULL,
  source_submission_id uuid UNIQUE REFERENCES partner_storefront_submissions(id) ON DELETE SET NULL,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2000 AND 3000),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  headline text,
  link_url text,
  surfaces text[] NOT NULL DEFAULT ARRAY['business_wall']::text[],
  start_on date,
  end_on date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','active','complete','cancelled')),
  amount_usd numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_usd >= 0),
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending','paid','waived')),
  contribution_id uuid UNIQUE REFERENCES sponsor_contributions(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (link_url IS NULL OR link_url ~ '^https?://'),
  CHECK (surfaces <@ ARRAY['dashboard_footer','pit_footer','business_wall']::text[]),
  CHECK (end_on IS NULL OR start_on IS NULL OR end_on >= start_on)
);
CREATE INDEX partner_campaigns_org_season_idx
  ON partner_placement_campaigns(org_id, season_year, status, start_on, end_on);

ALTER TABLE partner_program_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_placement_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sponsor_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_storefront_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_placement_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY partner_settings_member_read ON partner_program_settings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY partner_settings_admin_write ON partner_program_settings FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND updated_by = current_app_user_id());
CREATE POLICY partner_packages_member_read ON partner_placement_packages FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY partner_packages_admin_write ON partner_placement_packages FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY sponsor_assets_member_read ON sponsor_assets FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY sponsor_assets_admin_write ON sponsor_assets FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY partner_submissions_admin_read ON partner_storefront_submissions FOR SELECT TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY partner_submissions_admin_update ON partner_storefront_submissions FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY partner_campaigns_member_read ON partner_placement_campaigns FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY partner_campaigns_admin_write ON partner_placement_campaigns FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON partner_program_settings, partner_placement_packages,
  sponsor_assets, partner_storefront_submissions, partner_placement_campaigns TO vantage_app, vantage_worker;

CREATE OR REPLACE FUNCTION get_public_partner_storefront(p_public_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'publicId', s.public_id,
    'orgName', o.name,
    'teamNumber', o.team_number,
    'pitch', s.pitch,
    'paymentUrl', s.payment_url,
    'packages', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'priceCents', round(p.price_usd * 100),
        'durationDays', p.duration_days, 'surfaces', p.surfaces, 'benefits', p.benefits
      ) ORDER BY p.sort_order, p.price_usd, p.name)
      FROM partner_placement_packages p WHERE p.org_id = s.org_id AND p.active
    ), '[]'::jsonb)
  )
  FROM partner_program_settings s
  JOIN organizations o ON o.id = s.org_id
  WHERE s.public_id = p_public_id AND s.storefront_enabled;
$$;

CREATE OR REPLACE FUNCTION create_public_partner_submission(
  p_public_id uuid, p_package_id uuid, p_company_name text, p_contact_name text,
  p_contact_email text, p_website text, p_headline text, p_message text, p_external_logo_url text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_org_id uuid; v_id uuid;
BEGIN
  SELECT org_id INTO v_org_id FROM partner_program_settings
  WHERE public_id = p_public_id AND storefront_enabled;
  IF v_org_id IS NULL THEN RAISE EXCEPTION 'Partner storefront is unavailable'; END IF;
  IF p_package_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM partner_placement_packages WHERE id = p_package_id AND org_id = v_org_id AND active
  ) THEN RAISE EXCEPTION 'Placement package is unavailable'; END IF;
  INSERT INTO partner_storefront_submissions(
    org_id, package_id, company_name, contact_name, contact_email, website, headline, message, external_logo_url
  ) VALUES (
    v_org_id, p_package_id, left(p_company_name,160), left(p_contact_name,160), left(p_contact_email,320),
    nullif(left(p_website,2000),''), nullif(left(p_headline,240),''), nullif(left(p_message,4000),''),
    nullif(left(p_external_logo_url,2000),'')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION get_public_partner_placements(p_org_id uuid, p_surface text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id, 'sponsorName', s.name, 'headline', c.headline, 'linkUrl', c.link_url,
    'assetPublicId', a.public_id, 'startOn', c.start_on, 'endOn', c.end_on
  ) ORDER BY c.amount_usd DESC, c.created_at), '[]'::jsonb)
  FROM partner_placement_campaigns c
  JOIN sponsors s ON s.id = c.sponsor_id AND s.org_id = c.org_id
  LEFT JOIN sponsor_assets a ON a.id = c.asset_id AND a.org_id = c.org_id AND a.status = 'approved'
  WHERE c.org_id = p_org_id
    AND p_surface = ANY(c.surfaces)
    AND c.status IN ('approved','active')
    AND c.payment_status IN ('paid','waived')
    AND (c.start_on IS NULL OR c.start_on <= current_date)
    AND (c.end_on IS NULL OR c.end_on >= current_date);
$$;

CREATE OR REPLACE FUNCTION get_public_partner_asset(p_public_id uuid)
RETURNS TABLE(media_type text, bytes bytea, checksum_sha256 text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.media_type, a.bytes, a.checksum_sha256
  FROM sponsor_assets a
  WHERE a.public_id = p_public_id AND a.status = 'approved'
    AND EXISTS (
      SELECT 1 FROM partner_placement_campaigns c
      WHERE c.asset_id = a.id AND c.org_id = a.org_id
        AND c.status IN ('approved','active') AND c.payment_status IN ('paid','waived')
        AND (c.start_on IS NULL OR c.start_on <= current_date)
        AND (c.end_on IS NULL OR c.end_on >= current_date)
    );
$$;

REVOKE ALL ON FUNCTION get_public_partner_storefront(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_public_partner_submission(uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_partner_placements(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_partner_asset(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_partner_storefront(uuid) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION create_public_partner_submission(uuid,uuid,text,text,text,text,text,text,text) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION get_public_partner_placements(uuid,text) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION get_public_partner_asset(uuid) TO vantage_app, vantage_worker;
