-- Team-shared coding-agent configuration: a team authors rules, subagent
-- definitions, MCP server entries, permission snippets, and skills ONCE and
-- every member's agent consumes them (Claude Code via `vantage-cad agent sync`,
-- custom agents via GET /api/agent-config/bundle, the in-app agent directly).
-- Members read; owners/admins write; a per-org toggle can open writes to members.

CREATE TABLE agent_config_settings (
  org_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  allow_member_edits boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agent_config_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_config_settings_member_read ON agent_config_settings FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY agent_config_settings_admin_insert ON agent_config_settings FOR INSERT TO vantage_app
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY agent_config_settings_admin_update ON agent_config_settings FOR UPDATE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]))
  WITH CHECK (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));
CREATE POLICY agent_config_settings_admin_delete ON agent_config_settings FOR DELETE TO vantage_app
  USING (has_org_role(org_id, ARRAY['owner','admin']::org_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_config_settings TO vantage_app, vantage_worker;

-- Editing is allowed for owners/admins always, and for plain members only when
-- the org has opted in via agent_config_settings.allow_member_edits.
CREATE FUNCTION can_edit_agent_config(check_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT has_org_role(check_org_id, ARRAY['owner','admin']::org_role[])
      OR (is_org_member(check_org_id) AND EXISTS (
            SELECT 1 FROM agent_config_settings s
             WHERE s.org_id = check_org_id AND s.allow_member_edits));
$$;

CREATE TABLE agent_config_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('rules','subagent','mcp-server','permissions','skill')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  description text,
  -- Markdown (rules / subagent / skill) or JSON (mcp-server / permissions).
  content text NOT NULL CHECK (char_length(content) <= 65536),
  -- Rows that fail format validation still save (never lose a draft) but are
  -- excluded from sync bundles and badged invalid in the UI.
  format_valid boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, kind, name)
);
CREATE INDEX agent_config_items_org_kind_idx ON agent_config_items(org_id, kind, name);

ALTER TABLE agent_config_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_config_items_member_read ON agent_config_items FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY agent_config_items_editor_insert ON agent_config_items FOR INSERT TO vantage_app
  WITH CHECK (can_edit_agent_config(org_id) AND updated_by = current_app_user_id());
CREATE POLICY agent_config_items_editor_update ON agent_config_items FOR UPDATE TO vantage_app
  USING (can_edit_agent_config(org_id))
  WITH CHECK (can_edit_agent_config(org_id) AND updated_by = current_app_user_id());
CREATE POLICY agent_config_items_editor_delete ON agent_config_items FOR DELETE TO vantage_app
  USING (can_edit_agent_config(org_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_config_items TO vantage_app, vantage_worker;

-- Every save appends the new content here so edits keep history and any
-- revision can be restored (restore = a new save of the old content).
CREATE TABLE agent_config_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES agent_config_items(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  content text NOT NULL,
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, version)
);
CREATE INDEX agent_config_revisions_item_idx ON agent_config_revisions(item_id, version DESC);

ALTER TABLE agent_config_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_config_revisions_member_read ON agent_config_revisions FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY agent_config_revisions_editor_insert ON agent_config_revisions FOR INSERT TO vantage_app
  WITH CHECK (can_edit_agent_config(org_id) AND updated_by = current_app_user_id());
-- Revisions are append-only history: no UPDATE/DELETE policies for the app role
-- (rows disappear only through the item's ON DELETE CASCADE).

GRANT SELECT, INSERT ON agent_config_revisions TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_config_revisions TO vantage_worker;
