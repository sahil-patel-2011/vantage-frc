-- Team alumni network + Discord connection. Alumni are a shared per-team
-- directory any member can read and contribute to; owners/admins curate. The
-- Discord webhook is a secret (admin-only by RLS) used to post alumni-network
-- announcements to the team's Discord server.

CREATE TABLE team_alumni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  grad_year integer CHECK (grad_year IS NULL OR grad_year BETWEEN 1990 AND 2100),
  -- `current_role` is a reserved SQL keyword, so it must stay quoted everywhere it
  -- is named unqualified (see apps/web/lib/alumni/store.ts).
  "current_role" text,
  email text,
  discord_handle text,
  linkedin_url text,
  note text,
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_alumni_org_idx ON team_alumni(org_id, grad_year DESC);

ALTER TABLE team_alumni ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_alumni_member_read ON team_alumni FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY team_alumni_member_insert ON team_alumni FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND added_by = current_app_user_id());
CREATE POLICY team_alumni_admin_update ON team_alumni FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY team_alumni_delete ON team_alumni FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR added_by = current_app_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON team_alumni TO vantage_app, vantage_worker;

CREATE TABLE team_discord (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  webhook_url text NOT NULL,
  channel_label text,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE team_discord ENABLE ROW LEVEL SECURITY;
-- Admin-only: the webhook URL is a bearer secret; members never read this row.
CREATE POLICY team_discord_admin_all ON team_discord FOR ALL TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) AND updated_by = current_app_user_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON team_discord TO vantage_app, vantage_worker;
