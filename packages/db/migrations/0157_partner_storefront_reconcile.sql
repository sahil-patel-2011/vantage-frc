-- Reconcile partner storefront schema + SECURITY DEFINER helpers with the
-- application contracts in apps/web (0046 file was rewritten after an older
-- variant had already been marked applied). Idempotent column renames only.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sponsor_assets' AND column_name = 'filename'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sponsor_assets' AND column_name = 'name'
  ) THEN
    ALTER TABLE sponsor_assets RENAME COLUMN filename TO name;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sponsor_assets' AND column_name = 'image_bytes'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sponsor_assets' AND column_name = 'bytes'
  ) THEN
    ALTER TABLE sponsor_assets RENAME COLUMN image_bytes TO bytes;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sponsor_assets' AND column_name = 'checksum'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sponsor_assets' AND column_name = 'checksum_sha256'
  ) THEN
    ALTER TABLE sponsor_assets RENAME COLUMN checksum TO checksum_sha256;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sponsor_assets' AND column_name = 'uploaded_by'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sponsor_assets' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE sponsor_assets RENAME COLUMN uploaded_by TO created_by;
  END IF;
END $$;

ALTER TABLE sponsor_assets
  ADD COLUMN IF NOT EXISTS byte_size integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE sponsor_assets
SET byte_size = octet_length(bytes)
WHERE byte_size IS NULL AND bytes IS NOT NULL;

ALTER TABLE sponsor_assets ALTER COLUMN byte_size SET DEFAULT 0;
UPDATE sponsor_assets SET byte_size = 0 WHERE byte_size IS NULL;
ALTER TABLE sponsor_assets ALTER COLUMN byte_size SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_storefront_submissions'
      AND column_name = 'logo_url'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_storefront_submissions'
      AND column_name = 'external_logo_url'
  ) THEN
    ALTER TABLE partner_storefront_submissions RENAME COLUMN logo_url TO external_logo_url;
  END IF;
END $$;

ALTER TABLE partner_storefront_submissions
  ADD COLUMN IF NOT EXISTS headline text,
  ADD COLUMN IF NOT EXISTS external_logo_url text;

CREATE OR REPLACE FUNCTION get_public_partner_storefront(p_public_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
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
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
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

CREATE OR REPLACE FUNCTION public_partner_storefront(p_public_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT get_public_partner_storefront(p_public_id);
$$;

CREATE OR REPLACE FUNCTION public_partner_placements(p_org_id uuid, p_surface text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT get_public_partner_placements(p_org_id, p_surface);
$$;

CREATE OR REPLACE FUNCTION public_partner_asset(p_public_id uuid)
RETURNS TABLE(media_type text, image_bytes bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT g.media_type, g.bytes FROM get_public_partner_asset(p_public_id) g;
$$;

CREATE OR REPLACE FUNCTION submit_partner_storefront_interest(
  p_public_id uuid, p_package_id uuid, p_company_name text, p_contact_name text,
  p_contact_email text, p_website text, p_message text, p_logo_url text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN create_public_partner_submission(
    p_public_id, p_package_id, p_company_name, p_contact_name, p_contact_email,
    p_website, null, p_message, p_logo_url
  );
END;
$$;

REVOKE ALL ON FUNCTION get_public_partner_storefront(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_public_partner_submission(uuid,uuid,text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_partner_placements(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_partner_asset(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public_partner_storefront(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public_partner_placements(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public_partner_asset(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_partner_storefront_interest(uuid,uuid,text,text,text,text,text,text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION get_public_partner_storefront(uuid) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION create_public_partner_submission(uuid,uuid,text,text,text,text,text,text,text) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION get_public_partner_placements(uuid,text) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION get_public_partner_asset(uuid) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION public_partner_storefront(uuid) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION public_partner_placements(uuid,text) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION public_partner_asset(uuid) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION submit_partner_storefront_interest(uuid,uuid,text,text,text,text,text,text) TO vantage_app, vantage_worker;
