-- Store the member behind a season role. The display name remains nullable for
-- historical/free-text holders, while holder_user_id gives downstream
-- notifications, training, and handoff workflows a stable identity.

ALTER TABLE team_roles
  ADD COLUMN IF NOT EXISTS holder_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS team_roles_holder_user_idx
  ON team_roles(org_id, holder_user_id)
  WHERE holder_user_id IS NOT NULL;

COMMENT ON COLUMN team_roles.holder_user_id IS
  'Confirmed roster member holding this role. NULL preserves unfilled and legacy free-text holders.';
