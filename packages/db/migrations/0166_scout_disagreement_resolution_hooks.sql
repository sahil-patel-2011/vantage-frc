-- CD #6 integrate: disagreement resolution columns, audit trail, and coordinator notify.

ALTER TABLE scout_disagreements
  ADD COLUMN IF NOT EXISTS winning_entry_id uuid REFERENCES match_scout_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS winning_scout_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chosen_value jsonb;

CREATE TABLE IF NOT EXISTS scout_disagreement_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  disagreement_id uuid NOT NULL REFERENCES scout_disagreements(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK (action IN ('resolved', 'dismissed', 'reopened')),
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scout_disagreement_audit_org_created_idx
  ON scout_disagreement_audit(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scout_disagreement_audit_disagreement_idx
  ON scout_disagreement_audit(disagreement_id, created_at DESC);

ALTER TABLE scout_disagreement_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scout_disagreement_audit_member_read ON scout_disagreement_audit;
DROP POLICY IF EXISTS scout_disagreement_audit_member_insert ON scout_disagreement_audit;
CREATE POLICY scout_disagreement_audit_member_read ON scout_disagreement_audit FOR SELECT TO vantage_app
  USING (is_org_member(org_id));
CREATE POLICY scout_disagreement_audit_member_insert ON scout_disagreement_audit FOR INSERT TO vantage_app
  WITH CHECK (
    is_org_member(org_id)
    AND actor_user_id = current_app_user_id()
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
  );

GRANT SELECT, INSERT ON scout_disagreement_audit TO vantage_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON scout_disagreement_audit TO vantage_worker;

DROP POLICY IF EXISTS notifications_scouting_disagreement_insert ON notifications;
CREATE POLICY notifications_scouting_disagreement_insert ON notifications FOR INSERT TO vantage_app
  WITH CHECK (
    type = 'scouting_disagreement_resolved'
    AND org_id IS NOT NULL
    AND has_org_role(org_id, ARRAY['owner','admin']::org_role[])
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = notifications.org_id
        AND m.user_id = notifications.user_id
        AND m.role IN ('owner', 'admin')
    )
  );
