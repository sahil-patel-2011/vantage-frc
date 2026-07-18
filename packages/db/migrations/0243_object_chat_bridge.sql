-- Object-linked subteam comm bridge: link a chat thread to a domain object (subsystem, order,
-- incident) so the right subteam gets notified with context. Self-contained tables — chat
-- threads are referenced by free-text label/ref, not FK'd, so this never couples to the chat
-- feature's schema.

CREATE TABLE object_chat_bridge_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  object_type text NOT NULL DEFAULT 'subsystem'
    CHECK (object_type IN ('subsystem','order','incident','other')),
  object_ref text NOT NULL,
  object_label text,
  thread_ref text NOT NULL,
  subteam text NOT NULL DEFAULT 'other'
    CHECK (subteam IN ('mechanical','electrical','software','business','drive','other')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','resolved','archived')),
  context text,
  season_year integer NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX object_chat_bridge_links_org_season_idx
  ON object_chat_bridge_links(org_id, season_year, created_at DESC);

ALTER TABLE object_chat_bridge_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY object_chat_bridge_links_member_read ON object_chat_bridge_links FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY object_chat_bridge_links_member_insert ON object_chat_bridge_links FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY object_chat_bridge_links_member_update ON object_chat_bridge_links FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY object_chat_bridge_links_member_delete ON object_chat_bridge_links FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON object_chat_bridge_links TO vantage_app, vantage_worker;

CREATE TABLE object_chat_bridge_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  link_id uuid NOT NULL REFERENCES object_chat_bridge_links(id) ON DELETE CASCADE,
  notified_subteam text NOT NULL DEFAULT 'other'
    CHECK (notified_subteam IN ('mechanical','electrical','software','business','drive','other')),
  message text NOT NULL,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX object_chat_bridge_notifications_org_link_idx
  ON object_chat_bridge_notifications(org_id, link_id, created_at DESC);

ALTER TABLE object_chat_bridge_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY object_chat_bridge_notifications_member_read ON object_chat_bridge_notifications FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY object_chat_bridge_notifications_member_insert ON object_chat_bridge_notifications FOR INSERT TO vantage_app
  WITH CHECK (is_org_member(org_id) AND created_by = current_app_user_id());
CREATE POLICY object_chat_bridge_notifications_member_update ON object_chat_bridge_notifications FOR UPDATE TO vantage_app
  USING (is_org_member(org_id)) WITH CHECK (is_org_member(org_id));
CREATE POLICY object_chat_bridge_notifications_member_delete ON object_chat_bridge_notifications FOR DELETE TO vantage_app
  USING (is_org_member(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON object_chat_bridge_notifications TO vantage_app, vantage_worker;
