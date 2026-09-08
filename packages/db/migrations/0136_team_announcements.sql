-- Team announcements. 0137 assumed a 0124_team_announcements.sql that was never
-- committed, so `ALTER TABLE team_announcements` failed and every migration after
-- it was unreachable on a from-zero database. This creates the table 0137 patches.
--
-- Real consumers today (no dedicated page yet):
--   * apps/web/lib/notify-match.ts writes a match alert + de-dupes on (org_id, title)
--     within a cooldown window, and records whether the Discord cross-post landed.
--   * apps/web/app/api/messages/route.ts resolves `objectType: "announcement"` links
--     and searches announcements by title.

CREATE TABLE IF NOT EXISTS team_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
  pinned boolean NOT NULL DEFAULT false,
  require_ack boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_announcements_org_created_idx
  ON team_announcements (org_id, created_at DESC);
-- notify-match de-dupes with `WHERE org_id = $1 AND title = $2 AND created_at > ...`.
CREATE INDEX IF NOT EXISTS team_announcements_org_title_idx
  ON team_announcements (org_id, title);

ALTER TABLE team_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_announcements_member_read ON team_announcements;
CREATE POLICY team_announcements_member_read ON team_announcements FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

-- Any member may post (the match alert is written by whoever opened My Day);
-- edit/delete stay with the author or an owner/admin.
DROP POLICY IF EXISTS team_announcements_member_insert ON team_announcements;
CREATE POLICY team_announcements_member_insert ON team_announcements FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id));

DROP POLICY IF EXISTS team_announcements_author_update ON team_announcements;
CREATE POLICY team_announcements_author_update ON team_announcements FOR UPDATE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR created_by = current_app_user_id()
  )
  WITH CHECK (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR created_by = current_app_user_id()
  );

DROP POLICY IF EXISTS team_announcements_author_delete ON team_announcements;
CREATE POLICY team_announcements_author_delete ON team_announcements FOR DELETE TO vantage_app
  USING (
    has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
    OR created_by = current_app_user_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON team_announcements TO vantage_app, vantage_worker;
