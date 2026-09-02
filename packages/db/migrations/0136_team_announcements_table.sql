-- Repairs a gap in the migration set: 0137 alters team_announcements and the
-- app inserts into it (lib/notify-match.ts, api/messages object links), but no
-- migration ever created it (the file 0137 credits as 0124 does not exist).
-- Idempotent so a database that already carries the table is untouched.

CREATE TABLE IF NOT EXISTS team_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
  pinned boolean NOT NULL DEFAULT false,
  require_ack boolean NOT NULL DEFAULT false,
  posted_to_discord boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_announcements_org_created_idx ON team_announcements(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS team_announcement_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  announcement_id uuid NOT NULL REFERENCES team_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (announcement_id, user_id)
);

ALTER TABLE team_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_announcement_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_announcements_member_select ON team_announcements;
CREATE POLICY team_announcements_member_select ON team_announcements
  FOR SELECT USING (is_org_member(org_id));
DROP POLICY IF EXISTS team_announcements_member_insert ON team_announcements;
CREATE POLICY team_announcements_member_insert ON team_announcements
  FOR INSERT WITH CHECK (is_org_member(org_id) AND (created_by IS NULL OR created_by = current_app_user_id()));
DROP POLICY IF EXISTS team_announcements_admin_write ON team_announcements;
CREATE POLICY team_announcements_admin_write ON team_announcements
  FOR UPDATE USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR created_by = current_app_user_id());
DROP POLICY IF EXISTS team_announcements_admin_delete ON team_announcements;
CREATE POLICY team_announcements_admin_delete ON team_announcements
  FOR DELETE USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]) OR created_by = current_app_user_id());

DROP POLICY IF EXISTS team_announcement_acks_member ON team_announcement_acks;
CREATE POLICY team_announcement_acks_member ON team_announcement_acks
  FOR ALL USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id) AND user_id = current_app_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON team_announcements TO vantage_app, vantage_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_announcement_acks TO vantage_app, vantage_worker;
