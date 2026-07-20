-- Platform-admin CRM: app sponsors / AI partners + org outreach.
-- API keys stay in env / BYOK vault — never stored in these tables.
-- platform_admins write; authenticated members may read active sponsors for Soft-UI branding.

CREATE TABLE IF NOT EXISTS platform_app_sponsors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  website_url text,
  tier text NOT NULL DEFAULT 'partner'
    CHECK (tier IN ('title', 'ai', 'partner', 'prospect')),
  status text NOT NULL DEFAULT 'prospect'
    CHECK (status IN ('prospect', 'active', 'paused', 'ended')),
  outreach_status text NOT NULL DEFAULT 'not_started'
    CHECK (outreach_status IN (
      'not_started', 'contacted', 'in_discussion', 'committed', 'declined', 'on_hold'
    )),
  -- Framing only (no secrets): partner covers models, or direct keys with partner branding.
  ai_coverage text NOT NULL DEFAULT 'none'
    CHECK (ai_coverage IN ('none', 'partner_sponsored', 'direct_keys_partner_brand')),
  brand_tagline text,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  CONSTRAINT platform_app_sponsors_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  CONSTRAINT platform_app_sponsors_logo_url_ck CHECK (
    logo_url IS NULL OR logo_url ~ '^https://'
  ),
  CONSTRAINT platform_app_sponsors_website_url_ck CHECK (
    website_url IS NULL OR website_url ~ '^https://'
  ),
  CONSTRAINT platform_app_sponsors_tagline_len CHECK (
    brand_tagline IS NULL OR char_length(brand_tagline) BETWEEN 1 AND 120
  ),
  CONSTRAINT platform_app_sponsors_notes_len CHECK (
    notes IS NULL OR char_length(notes) <= 8000
  )
);

CREATE INDEX IF NOT EXISTS platform_app_sponsors_status_sort_idx
  ON platform_app_sponsors (status, sort_order ASC, name ASC);

CREATE TABLE IF NOT EXISTS platform_org_outreach (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name text NOT NULL,
  contact_name text,
  contact_email text,
  status text NOT NULL DEFAULT 'prospect'
    CHECK (status IN (
      'prospect', 'contacted', 'demo', 'negotiating', 'won', 'lost', 'nurture'
    )),
  notes text,
  next_action_at date,
  linked_org_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id),
  CONSTRAINT platform_org_outreach_org_name_len CHECK (char_length(btrim(org_name)) BETWEEN 1 AND 160),
  CONSTRAINT platform_org_outreach_contact_name_len CHECK (
    contact_name IS NULL OR char_length(btrim(contact_name)) BETWEEN 1 AND 160
  ),
  CONSTRAINT platform_org_outreach_contact_email_len CHECK (
    contact_email IS NULL OR char_length(btrim(contact_email)) BETWEEN 3 AND 320
  ),
  CONSTRAINT platform_org_outreach_notes_len CHECK (
    notes IS NULL OR char_length(notes) <= 8000
  )
);

CREATE INDEX IF NOT EXISTS platform_org_outreach_status_next_idx
  ON platform_org_outreach (status, next_action_at ASC NULLS LAST, updated_at DESC);

ALTER TABLE platform_app_sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_org_outreach ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_app_sponsors_admin ON platform_app_sponsors;
CREATE POLICY platform_app_sponsors_admin ON platform_app_sponsors
  FOR ALL TO vantage_app
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

-- Soft-UI AI branding: any signed-in user may read active sponsor display fields only.
DROP POLICY IF EXISTS platform_app_sponsors_active_read ON platform_app_sponsors;
CREATE POLICY platform_app_sponsors_active_read ON platform_app_sponsors
  FOR SELECT TO vantage_app
  USING (status = 'active' AND current_app_user_id() IS NOT NULL);

DROP POLICY IF EXISTS platform_org_outreach_admin ON platform_org_outreach;
CREATE POLICY platform_org_outreach_admin ON platform_org_outreach
  FOR ALL TO vantage_app
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_app_sponsors, platform_org_outreach
  TO vantage_app, vantage_worker;
