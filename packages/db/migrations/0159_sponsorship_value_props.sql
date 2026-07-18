-- Sponsorship value proposition one-pagers: org-isolated pitch sheets for
-- cash / parts / mentorship asks. Never join or seed across organizations —
-- who_we_are must describe THIS team only.

CREATE TABLE IF NOT EXISTS sponsorship_value_props (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL CHECK (season_year BETWEEN 2000 AND 3000),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  who_we_are text NOT NULL DEFAULT '' CHECK (char_length(who_we_are) <= 4000),
  what_we_do text NOT NULL DEFAULT '' CHECK (char_length(what_we_do) <= 4000),
  ask_cash_usd numeric(12,2) CHECK (ask_cash_usd IS NULL OR ask_cash_usd >= 0),
  ask_parts text NOT NULL DEFAULT '' CHECK (char_length(ask_parts) <= 2000),
  ask_mentorship text NOT NULL DEFAULT '' CHECK (char_length(ask_mentorship) <= 2000),
  sponsor_gets text NOT NULL DEFAULT '' CHECK (char_length(sponsor_gets) <= 4000),
  invite_enabled boolean NOT NULL DEFAULT false,
  invite_details text NOT NULL DEFAULT '' CHECK (char_length(invite_details) <= 2000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sponsorship_value_props_org_season_idx
  ON sponsorship_value_props(org_id, season_year, updated_at DESC);

ALTER TABLE sponsorship_value_props ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sponsorship_value_props_read ON sponsorship_value_props;
DROP POLICY IF EXISTS sponsorship_value_props_insert ON sponsorship_value_props;
DROP POLICY IF EXISTS sponsorship_value_props_update ON sponsorship_value_props;
DROP POLICY IF EXISTS sponsorship_value_props_delete ON sponsorship_value_props;

-- Members of THIS org only — RLS blocks every cross-org read/write.
CREATE POLICY sponsorship_value_props_read ON sponsorship_value_props
  FOR SELECT TO vantage_app USING (is_org_member(org_id));

CREATE POLICY sponsorship_value_props_insert ON sponsorship_value_props
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

CREATE POLICY sponsorship_value_props_update ON sponsorship_value_props
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id));

CREATE POLICY sponsorship_value_props_delete ON sponsorship_value_props
  FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON sponsorship_value_props TO vantage_app, vantage_worker;
