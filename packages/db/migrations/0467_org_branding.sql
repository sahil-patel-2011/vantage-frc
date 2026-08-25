-- Team branding + personal appearance.
--
-- org_branding: one row per team. Holds the team accent (validated 6-digit hex),
-- an optional small PNG logo stored as bytes (same pattern as 0046 sponsor_assets:
-- normalized server-side by sharp, checksummed, byte-capped) and the display flags
-- owners/admins use to decide how far the branding reaches into member chrome.
--
-- profiles.appearance_prefs: the per-member half (density, motion, accent opt-out).
-- Deliberately a NEW column rather than a second prefs store — /api/account remains
-- the only writer of notification_prefs, /api/branding/appearance the only writer of
-- this one, so the two column-scoped upserts can never clobber each other.

CREATE TABLE org_branding (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  -- NULL = "use the Vantage default accent". Stored lowercase so the CHECK is exact.
  accent_color text CHECK (accent_color ~ '^#[0-9a-f]{6}$'),

  logo_bytes bytea,
  logo_media_type text CHECK (logo_media_type = 'image/png'),
  logo_byte_size integer CHECK (logo_byte_size BETWEEN 1 AND 262144),
  logo_width integer CHECK (logo_width BETWEEN 1 AND 512),
  logo_height integer CHECK (logo_height BETWEEN 1 AND 512),
  logo_checksum_sha256 text CHECK (logo_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  logo_updated_at timestamptz,

  -- Display flags: members can still opt out personally, these are the team ceiling.
  show_logo_in_header boolean NOT NULL DEFAULT true,
  apply_accent_to_app boolean NOT NULL DEFAULT true,

  updated_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Logo columns move together or not at all.
  CONSTRAINT org_branding_logo_complete CHECK (
    (logo_bytes IS NULL
      AND logo_media_type IS NULL
      AND logo_byte_size IS NULL
      AND logo_width IS NULL
      AND logo_height IS NULL
      AND logo_checksum_sha256 IS NULL)
    OR
    (logo_bytes IS NOT NULL
      AND logo_media_type IS NOT NULL
      AND logo_byte_size IS NOT NULL
      AND logo_width IS NOT NULL
      AND logo_height IS NOT NULL
      AND logo_checksum_sha256 IS NOT NULL)
  )
);

ALTER TABLE org_branding ENABLE ROW LEVEL SECURITY;

-- Every member sees the branding their team chose; only owner/admin may change it.
CREATE POLICY org_branding_member_read ON org_branding FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY org_branding_admin_write ON org_branding FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND updated_by = current_app_user_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON org_branding TO vantage_app, vantage_worker;

-- Per-member appearance: {"density":"comfortable|compact","motion":"full|reduced","teamAccent":true|false}
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS appearance_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_appearance_prefs_shape;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_appearance_prefs_shape
  CHECK (jsonb_typeof(appearance_prefs) = 'object');
