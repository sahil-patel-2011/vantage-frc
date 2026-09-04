-- Named FreeBuff Pi devices the platform owner connects and watches.
-- Totals are device-wide (one shared session). Per-team tokens stay on
-- ai_usage_events. Isolation is what Vantage sends, not a property of the box.

CREATE TABLE IF NOT EXISTS free_relay_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  last_seen_at timestamptz,
  last_probe_at timestamptz,
  last_probe_ok boolean,
  last_probe_error text,
  tokens_day date,
  tokens_in_today bigint NOT NULL DEFAULT 0,
  tokens_out_today bigint NOT NULL DEFAULT 0,
  tokens_out_per_sec numeric,
  active_requests integer NOT NULL DEFAULT 0,
  max_concurrent integer,
  model text,
  bind_label text,
  upstream_ok boolean,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT free_relay_devices_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT free_relay_devices_tokens_nonneg CHECK (
    tokens_in_today >= 0 AND tokens_out_today >= 0 AND active_requests >= 0
  )
);

ALTER TABLE free_relay_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY free_relay_devices_platform_read ON free_relay_devices
  FOR SELECT TO vantage_app
  USING (is_platform_admin());

CREATE POLICY free_relay_devices_platform_insert ON free_relay_devices
  FOR INSERT TO vantage_app
  WITH CHECK (is_platform_admin() AND created_by = current_app_user_id());

CREATE POLICY free_relay_devices_platform_update ON free_relay_devices
  FOR UPDATE TO vantage_app
  USING (is_platform_admin())
  WITH CHECK (is_platform_admin());

GRANT SELECT, INSERT, UPDATE ON free_relay_devices TO vantage_app, vantage_worker;

COMMENT ON TABLE free_relay_devices IS
  'Platform-owned FreeBuff Pi boxes. Device totals only — never another team''s context.';
