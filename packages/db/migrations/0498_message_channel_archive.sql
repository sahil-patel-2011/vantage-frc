-- Team chat channels already use org_conversations(kind = 'team'). Add the
-- lifecycle field consumed by the channel service so owners can archive a
-- channel without deleting its exportable history.

ALTER TABLE org_conversations
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS org_conversations_org_live_channel_idx
  ON org_conversations(org_id, updated_at DESC)
  WHERE kind = 'team' AND archived_at IS NULL;

COMMENT ON COLUMN org_conversations.archived_at IS
  'When set, hides a team channel from the active inbox while preserving its messages and exports.';
