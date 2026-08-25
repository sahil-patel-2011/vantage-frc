-- Sponsor Wall public sharing: the wall is described as "a public thank-you wall", so give it
-- an actual public surface. Adds an unguessable public_id to sponsor_wall_settings and a
-- SECURITY DEFINER reader (same mechanism as get_public_partner_storefront in 0046/0157) that
-- returns only the published wall + published entries for tokenized, session-free reads at
-- /sponsor-wall/{public_id}. Unpublished walls and hidden entries never leak.

ALTER TABLE sponsor_wall_settings
  ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE sponsor_wall_settings
  ADD CONSTRAINT sponsor_wall_settings_public_id_key UNIQUE (public_id);

CREATE OR REPLACE FUNCTION get_public_sponsor_wall(p_public_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'publicId', s.public_id,
    'orgName', o.name,
    'teamNumber', o.team_number,
    'headline', s.headline,
    'subtitle', s.subtitle,
    'theme', s.theme,
    'entries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'sponsorName', e.sponsor_name,
        'tier', e.tier,
        'logoUrl', e.logo_url,
        'websiteUrl', e.website_url,
        'message', e.message
      ) ORDER BY
        CASE e.tier
          WHEN 'title' THEN 0 WHEN 'platinum' THEN 1 WHEN 'gold' THEN 2
          WHEN 'silver' THEN 3 WHEN 'bronze' THEN 4 WHEN 'inkind' THEN 5 ELSE 6
        END,
        e.display_order,
        e.created_at DESC)
      FROM sponsor_wall_entries e
      WHERE e.org_id = s.org_id AND e.published
    ), '[]'::jsonb)
  )
  FROM sponsor_wall_settings s
  JOIN organizations o ON o.id = s.org_id
  WHERE s.public_id = p_public_id AND s.published;
$$;

REVOKE ALL ON FUNCTION get_public_sponsor_wall(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_sponsor_wall(uuid) TO vantage_app, vantage_worker;
