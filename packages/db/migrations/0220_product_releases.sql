-- Product versioning + staged feature releases.
-- Platform catalog (not org-scoped). Targeting by plan audience; feature_flags / min_plan gate entitlements.
-- Product-update emails default ON (users can opt out). Hobby-safe: no new Vercel cron — scheduled publish piggybacks season sync.

-- Prefer product-update emails ON by default (changelog / release notes).
ALTER TABLE user_email_preferences
  ALTER COLUMN product_updates SET DEFAULT true;

-- Existing rows were created under the old opt-out default; flip them on so releases reach teams.
-- Users who later turn the preference off stay off.
UPDATE user_email_preferences SET product_updates = true, updated_at = now()
WHERE product_updates = false;

CREATE TABLE product_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  title text NOT NULL,
  version_label text,
  notes_markdown text NOT NULL DEFAULT '',
  audience_type text NOT NULL DEFAULT 'all'
    CHECK (audience_type IN ('all', 'paid', 'max', 'plan_codes')),
  audience_plan_codes text[] NOT NULL DEFAULT '{}',
  min_plan text REFERENCES pricing_plans(code),
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'published', 'cancelled')),
  scheduled_at timestamptz,
  published_at timestamptz,
  notify_email boolean NOT NULL DEFAULT true,
  notify_in_app boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_releases_slug_len CHECK (char_length(btrim(slug)) BETWEEN 2 AND 80),
  CONSTRAINT product_releases_title_len CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  CONSTRAINT product_releases_scheduled_ck CHECK (
    status <> 'scheduled' OR scheduled_at IS NOT NULL
  ),
  CONSTRAINT product_releases_plan_codes_ck CHECK (
    audience_type <> 'plan_codes' OR cardinality(audience_plan_codes) >= 1
  )
);

CREATE UNIQUE INDEX product_releases_slug_uq ON product_releases (lower(btrim(slug)));
CREATE INDEX product_releases_status_sched_idx ON product_releases (status, scheduled_at)
  WHERE status = 'scheduled';
CREATE INDEX product_releases_published_idx ON product_releases (published_at DESC NULLS LAST)
  WHERE status = 'published';

CREATE TABLE product_release_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES product_releases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_status text NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sent', 'skipped', 'setup_required', 'error', 'not_requested')),
  in_app_status text NOT NULL DEFAULT 'pending'
    CHECK (in_app_status IN ('pending', 'sent', 'skipped', 'not_requested')),
  email_error text,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, user_id)
);

CREATE INDEX product_release_deliveries_user_idx ON product_release_deliveries (user_id, created_at DESC);

CREATE TABLE product_release_acks (
  release_id uuid NOT NULL REFERENCES product_releases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (release_id, user_id)
);

ALTER TABLE product_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_release_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_release_acks ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_releases_platform_admin ON product_releases FOR ALL TO vantage_app
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());

CREATE POLICY product_releases_published_read ON product_releases FOR SELECT TO vantage_app
  USING (status = 'published' AND current_app_user_id() IS NOT NULL);

CREATE POLICY product_release_deliveries_platform ON product_release_deliveries FOR ALL TO vantage_app
  USING (is_platform_admin()) WITH CHECK (is_platform_admin());

CREATE POLICY product_release_deliveries_self_read ON product_release_deliveries FOR SELECT TO vantage_app
  USING (user_id = current_app_user_id());

CREATE POLICY product_release_acks_self ON product_release_acks FOR ALL TO vantage_app
  USING (user_id = current_app_user_id())
  WITH CHECK (user_id = current_app_user_id());

CREATE POLICY product_release_acks_platform_read ON product_release_acks FOR SELECT TO vantage_app
  USING (is_platform_admin());

-- Platform admin may fan out product_update inbox rows to any user.
DROP POLICY IF EXISTS notifications_product_update_platform_insert ON notifications;
CREATE POLICY notifications_product_update_platform_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (type = 'product_update' AND is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON product_releases, product_release_deliveries, product_release_acks
  TO vantage_app, vantage_worker;

-- Plan rank used by min_plan gates (individual/team tracks share ranks).
CREATE OR REPLACE FUNCTION product_plan_rank(plan_code text)
RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE plan_code
    WHEN 'free' THEN 0
    WHEN 'access' THEN 10
    WHEN 'individual_pro' THEN 20
    WHEN 'team_pro' THEN 20
    WHEN 'team_trial' THEN 20
    WHEN 'managed_20' THEN 20
    WHEN 'individual_max' THEN 30
    WHEN 'team_max' THEN 30
    WHEN 'managed_50' THEN 30
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION product_release_targets_plan(
  p_audience_type text,
  p_audience_plan_codes text[],
  p_min_plan text,
  p_plan_code text
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  matches boolean := false;
BEGIN
  IF p_plan_code IS NULL OR btrim(p_plan_code) = '' THEN
    RETURN false;
  END IF;

  IF p_audience_type = 'all' THEN
    matches := true;
  ELSIF p_audience_type = 'paid' THEN
    matches := p_plan_code <> 'free';
  ELSIF p_audience_type = 'max' THEN
    matches := p_plan_code IN ('individual_max', 'team_max', 'managed_50');
  ELSIF p_audience_type = 'plan_codes' THEN
    matches := p_plan_code = ANY (COALESCE(p_audience_plan_codes, '{}'::text[]));
  END IF;

  IF NOT matches THEN
    RETURN false;
  END IF;

  IF p_min_plan IS NOT NULL AND btrim(p_min_plan) <> '' THEN
    RETURN product_plan_rank(p_plan_code) >= product_plan_rank(p_min_plan);
  END IF;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION product_plan_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION product_release_targets_plan(text, text[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION product_plan_rank(text) TO vantage_app, vantage_worker;
GRANT EXECUTE ON FUNCTION product_release_targets_plan(text, text[], text, text) TO vantage_app, vantage_worker;

-- Recipients for a release: members of orgs whose plan matches audience + min_plan,
-- with product_updates email pref ON (default true when no prefs row yet).
CREATE OR REPLACE FUNCTION list_product_release_notify_recipients(p_release_id uuid)
RETURNS TABLE(user_id uuid, email text, unsubscribe_token text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rel record;
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'platform admin required';
  END IF;

  SELECT r.audience_type, r.audience_plan_codes, r.min_plan
  INTO rel
  FROM product_releases r
  WHERE r.id = p_release_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT u.id, u.email, COALESCE(p.unsubscribe_token, '')
  FROM memberships m
  JOIN org_entitlements e ON e.org_id = m.org_id
  JOIN users u ON u.id = m.user_id
  LEFT JOIN user_email_preferences p ON p.user_id = u.id
  WHERE e.status = 'active'
    AND (e.valid_until IS NULL OR e.valid_until > now())
    AND product_release_targets_plan(
      rel.audience_type,
      rel.audience_plan_codes,
      rel.min_plan,
      e.plan_code
    )
    AND COALESCE(p.product_updates, true) = true
    AND u.email IS NOT NULL
    AND btrim(u.email) <> '';
END $$;

REVOKE ALL ON FUNCTION list_product_release_notify_recipients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_product_release_notify_recipients(uuid) TO vantage_app, vantage_worker;

-- Also treat missing prefs as opted-in for product_updates in the legacy broadcast list.
CREATE OR REPLACE FUNCTION list_product_update_recipients()
RETURNS TABLE(user_id uuid, email text, unsubscribe_token text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_platform_admin() THEN
    RAISE EXCEPTION 'platform admin required';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email, COALESCE(p.unsubscribe_token, '')
  FROM users u
  LEFT JOIN user_email_preferences p ON p.user_id = u.id
  WHERE COALESCE(p.product_updates, true) = true
    AND u.email IS NOT NULL
    AND btrim(u.email) <> '';
END $$;

-- resolve_opt_in: missing prefs row => product_updates treated as ON (create token lazily via empty skip if no token).
-- Prefer ensuring prefs in app code; still COALESCE enabled for product_updates when row exists.
CREATE OR REPLACE FUNCTION resolve_opt_in_email_recipient(
  target_user_id uuid,
  category text
) RETURNS TABLE(email text, unsubscribe_token text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  enabled boolean := false;
  token text;
  recipient text;
BEGIN
  IF category NOT IN (
    'product_updates',
    'coach_assignments',
    'coach_todos',
    'coach_practice_reminders',
    'sponsor_reminders'
  ) THEN
    RETURN;
  END IF;

  SELECT
    CASE category
      WHEN 'product_updates' THEN COALESCE(p.product_updates, true)
      WHEN 'coach_assignments' THEN COALESCE(p.coach_assignments, false)
      WHEN 'coach_todos' THEN COALESCE(p.coach_todos, false)
      WHEN 'coach_practice_reminders' THEN COALESCE(p.coach_practice_reminders, false)
      WHEN 'sponsor_reminders' THEN COALESCE(p.sponsor_reminders, false)
    END,
    p.unsubscribe_token
  INTO enabled, token
  FROM user_email_preferences p
  WHERE p.user_id = target_user_id;

  -- No prefs row yet: product_updates defaults ON; other categories stay off.
  IF NOT FOUND THEN
    IF category = 'product_updates' THEN
      enabled := true;
      token := NULL;
    ELSE
      RETURN;
    END IF;
  END IF;

  IF NOT COALESCE(enabled, false) THEN
    RETURN;
  END IF;

  SELECT u.email INTO recipient
  FROM users u
  WHERE u.id = target_user_id AND u.email IS NOT NULL AND btrim(u.email) <> '';

  IF recipient IS NULL THEN
    RETURN;
  END IF;

  -- Lazily mint prefs + token when product_updates default-on and no row yet.
  IF token IS NULL OR btrim(token) = '' THEN
    INSERT INTO user_email_preferences (user_id, product_updates, unsubscribe_token)
    VALUES (
      target_user_id,
      true,
      translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_')
    )
    ON CONFLICT (user_id) DO UPDATE SET
      updated_at = now()
    RETURNING unsubscribe_token INTO token;
  END IF;

  IF token IS NULL OR btrim(token) = '' THEN
    RETURN;
  END IF;

  email := recipient;
  unsubscribe_token := token;
  RETURN NEXT;
END $$;
