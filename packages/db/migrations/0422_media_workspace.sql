-- Media workspace: in-app content calendar, drafts, and reminder flags.
-- Never stores DEMO engagement metrics — only planned/draft content the team records.

CREATE TABLE media_content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  season_year integer NOT NULL,
  kind text NOT NULL DEFAULT 'post'
    CHECK (kind IN ('post', 'story', 'reel', 'press', 'other')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'posted', 'cancelled')),
  platform text NOT NULL DEFAULT 'other'
    CHECK (platform IN ('instagram', 'tiktok', 'facebook', 'x', 'youtube', 'linkedin', 'press', 'other')),
  title text NOT NULL,
  caption text,
  due_at timestamptz,
  remind_at timestamptz,
  reminded_at timestamptz,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_content_items_org_due_idx
  ON media_content_items (org_id, due_at NULLS LAST, created_at DESC);
CREATE INDEX media_content_items_org_status_idx
  ON media_content_items (org_id, status, season_year DESC);
CREATE INDEX media_content_items_remind_idx
  ON media_content_items (org_id, remind_at)
  WHERE remind_at IS NOT NULL AND reminded_at IS NULL AND status IN ('draft', 'scheduled');

ALTER TABLE media_content_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY media_content_items_member_read ON media_content_items
  FOR SELECT TO vantage_app
  USING (is_org_member(org_id));

CREATE POLICY media_content_items_member_insert ON media_content_items
  FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());

CREATE POLICY media_content_items_member_update ON media_content_items
  FOR UPDATE TO vantage_app
  USING (is_org_member(org_id))
  WITH CHECK (is_org_member(org_id) AND updated_by = current_app_user_id());

CREATE POLICY media_content_items_member_delete ON media_content_items
  FOR DELETE TO vantage_app
  USING (
    created_by = current_app_user_id()
    OR has_org_role(org_id, ARRAY['owner', 'admin']::org_role[])
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON media_content_items TO vantage_app, vantage_worker;

COMMENT ON TABLE media_content_items IS
  'Org-scoped media content calendar / drafts / reminders — no invented engagement metrics';
