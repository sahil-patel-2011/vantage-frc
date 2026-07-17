-- Message update watermark (soft-delete + pin sync) and team-channel pins for match-day notes.
ALTER TABLE org_messages
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS pinned_by uuid REFERENCES users(id);

UPDATE org_messages
SET updated_at = COALESCE(deleted_at, created_at)
WHERE updated_at IS DISTINCT FROM COALESCE(deleted_at, created_at);

CREATE INDEX IF NOT EXISTS org_messages_conversation_updated_idx
  ON org_messages(conversation_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS org_messages_pinned_idx
  ON org_messages(conversation_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;
