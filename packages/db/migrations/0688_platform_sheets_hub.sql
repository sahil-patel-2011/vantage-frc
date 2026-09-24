-- The team-sheets hub registers its own web app address.
--
-- The platform owner deploys the hub script, opens its address once, and presses "Connect to
-- Vantage". The script signs its own /exec address with the shared hub secret; a platform
-- admin's browser carries it to Admin -> Integrations, which checks the signature and stores it
-- here. VANTAGE_SHEETS_HUB_URL still wins when it is set; this is the no-config path.
--
-- One row. The address is not a secret: every request to it must be signed with the secret,
-- which lives only in the server env and the script. Team syncs run as the team's own owner or
-- admin, so every app user may read the row; only platform admins may write it.

CREATE TABLE IF NOT EXISTS platform_sheets_hub (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  url text NOT NULL CHECK (
    url ~ '^https://script\.google\.com/(macros|a/macros/[A-Za-z0-9.-]{1,100})/s/[A-Za-z0-9_-]{20,200}/exec$'
  ),
  registered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  registered_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE platform_sheets_hub ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_sheets_hub_read ON platform_sheets_hub;
CREATE POLICY platform_sheets_hub_read ON platform_sheets_hub
  FOR SELECT TO vantage_app USING (true);

DROP POLICY IF EXISTS platform_sheets_hub_admin_write ON platform_sheets_hub;
CREATE POLICY platform_sheets_hub_admin_write ON platform_sheets_hub
  FOR ALL TO vantage_app USING (is_platform_admin()) WITH CHECK (is_platform_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON platform_sheets_hub TO vantage_app, vantage_worker;
