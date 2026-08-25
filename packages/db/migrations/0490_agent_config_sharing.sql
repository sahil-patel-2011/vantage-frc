-- Agent-config sharing scopes (builds on 0487_agent_config.sql).
--
-- Owner request: shared rules/skills/tools become shareable "to certain people
-- or available to the entire team". Each agent_config_items row gets a
-- visibility: 'team' (default — every org member sees and syncs it) or
-- 'members' (visible only to its creator, individually granted members, and
-- org owners/admins). Grants live in agent_config_item_grants.
--
-- Sync/bundle behavior (enforced in apps/web/lib/agent-config/store.ts on top
-- of these policies): a member's bundle = team-wide items + items granted to
-- them personally + items they created. Owners/admins can SEE restricted items
-- for management, but their own bundle also only carries team/own/granted rows.

ALTER TABLE agent_config_items
  ADD COLUMN visibility text NOT NULL DEFAULT 'team' CHECK (visibility IN ('team', 'members')),
  ADD COLUMN created_by uuid REFERENCES users(id);

-- Backfill: before this migration every item was effectively team-wide and the
-- last editor is the best available creator record.
UPDATE agent_config_items SET created_by = updated_by WHERE created_by IS NULL;
ALTER TABLE agent_config_items ALTER COLUMN created_by SET NOT NULL;

CREATE TABLE agent_config_item_grants (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES agent_config_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);
CREATE INDEX agent_config_item_grants_org_user_idx ON agent_config_item_grants(org_id, user_id);

ALTER TABLE agent_config_item_grants ENABLE ROW LEVEL SECURITY;

-- SELECT is deliberately self-contained (no subquery on agent_config_items):
-- the items SELECT policy below references this table, so a reference back
-- would make Postgres raise "infinite recursion detected in policy".
-- A member always sees their own grants; editors (owners/admins, plus plain
-- members when allow_member_edits is on) see the org's grant list to manage it.
CREATE POLICY agent_config_item_grants_read ON agent_config_item_grants FOR SELECT TO vantage_app
  USING (is_org_member(org_id) AND (user_id = current_app_user_id() OR can_edit_agent_config(org_id)));

-- Editors manage grants, but only on items they can currently see (the EXISTS
-- runs under the items SELECT policy), and only for actual org members.
CREATE POLICY agent_config_item_grants_editor_insert ON agent_config_item_grants FOR INSERT TO vantage_app
  WITH CHECK (
    can_edit_agent_config(org_id)
    AND granted_by = current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM agent_config_items i
      WHERE i.id = agent_config_item_grants.item_id AND i.org_id = agent_config_item_grants.org_id
    )
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = agent_config_item_grants.org_id AND m.user_id = agent_config_item_grants.user_id
    )
  );
CREATE POLICY agent_config_item_grants_editor_delete ON agent_config_item_grants FOR DELETE TO vantage_app
  USING (
    can_edit_agent_config(org_id)
    AND EXISTS (
      SELECT 1 FROM agent_config_items i
      WHERE i.id = agent_config_item_grants.item_id AND i.org_id = agent_config_item_grants.org_id
    )
  );

GRANT SELECT, INSERT, DELETE ON agent_config_item_grants TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_config_item_grants TO vantage_worker;

-- Rewritten item policies: 'members'-restricted rows are visible (and
-- editable) only for the creator, individually granted members, and org
-- owners/admins. 'team' rows keep the 0487 behavior.

DROP POLICY agent_config_items_member_read ON agent_config_items;
CREATE POLICY agent_config_items_member_read ON agent_config_items FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND (
      visibility = 'team'
      OR created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM agent_config_item_grants g
        WHERE g.item_id = agent_config_items.id AND g.user_id = current_app_user_id()
      )
    )
  );

-- INSERT now also pins created_by to the caller (0487 already pinned updated_by).
DROP POLICY agent_config_items_editor_insert ON agent_config_items;
CREATE POLICY agent_config_items_editor_insert ON agent_config_items FOR INSERT TO vantage_app
  WITH CHECK (
    can_edit_agent_config(org_id)
    AND updated_by = current_app_user_id()
    AND created_by = current_app_user_id()
  );

-- UPDATE/DELETE gain the same visibility gate so a plain member-editor cannot
-- blind-write (e.g. via upsert name collision) a restricted item they cannot see.
DROP POLICY agent_config_items_editor_update ON agent_config_items;
CREATE POLICY agent_config_items_editor_update ON agent_config_items FOR UPDATE TO vantage_app
  USING (
    can_edit_agent_config(org_id)
    AND (
      visibility = 'team'
      OR created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM agent_config_item_grants g
        WHERE g.item_id = agent_config_items.id AND g.user_id = current_app_user_id()
      )
    )
  )
  WITH CHECK (can_edit_agent_config(org_id) AND updated_by = current_app_user_id());

DROP POLICY agent_config_items_editor_delete ON agent_config_items;
CREATE POLICY agent_config_items_editor_delete ON agent_config_items FOR DELETE TO vantage_app
  USING (
    can_edit_agent_config(org_id)
    AND (
      visibility = 'team'
      OR created_by = current_app_user_id()
      OR has_org_role(org_id, ARRAY['owner','admin']::org_role[])
      OR EXISTS (
        SELECT 1 FROM agent_config_item_grants g
        WHERE g.item_id = agent_config_items.id AND g.user_id = current_app_user_id()
      )
    )
  );

-- Revision history follows the item's visibility: if you can see the item you
-- can see its history, otherwise not. The EXISTS runs under the rewritten
-- items SELECT policy above (no recursion: items policies never query
-- agent_config_revisions).
DROP POLICY agent_config_revisions_member_read ON agent_config_revisions;
CREATE POLICY agent_config_revisions_member_read ON agent_config_revisions FOR SELECT TO vantage_app
  USING (
    is_org_member(org_id)
    AND EXISTS (SELECT 1 FROM agent_config_items i WHERE i.id = agent_config_revisions.item_id)
  );
