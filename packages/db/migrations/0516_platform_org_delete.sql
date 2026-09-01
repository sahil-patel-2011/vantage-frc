-- Platform-admin team deletion.
--
-- 0005 gave platform admins INSERT / SELECT / UPDATE on organizations but deliberately
-- no DELETE, so "remove a team" had no code path at all. Deleting an organization row
-- cascades through every org_id FK (all declared ON DELETE CASCADE), which is the
-- intent: a removed team leaves no orphaned scouting, finance, or CAD rows behind.
--
-- This is intentionally the only DELETE policy on the table. An org owner cannot delete
-- their own workspace, because that would let a single compromised owner account
-- destroy a whole team's season. Removal stays a platform-operator action, MFA-gated
-- and audited in the route layer.

CREATE POLICY organizations_platform_delete ON organizations FOR DELETE TO vantage_app
  USING (is_platform_admin());

-- admin_actions.target_org_id was declared `REFERENCES organizations(id)` with no ON
-- DELETE action in 0000, i.e. NO ACTION. That would make deletion fail outright for any
-- team that has ever been touched by an admin action — including the
-- `organization.provisioned` row every team gets at creation.
--
-- Repoint it to SET NULL so the audit row SURVIVES the deletion instead of blocking it
-- or vanishing with it. The human-readable identity of the deleted team (id, team
-- number, slug, name) is written into the immutable `payload` jsonb by the delete
-- route, so the trail stays complete after target_org_id goes null.
ALTER TABLE admin_actions
  DROP CONSTRAINT admin_actions_target_org_id_fkey,
  ADD CONSTRAINT admin_actions_target_org_id_fkey
    FOREIGN KEY (target_org_id) REFERENCES organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN admin_actions.target_org_id IS
  'Nulled when the organization is deleted. The deleted team''s identity is preserved in payload so the audit trail outlives the workspace.';

-- membership_audit_events is org-scoped and CASCADEs by design (it holds per-member
-- history that must not outlive the team), so team-level deletions are reconstructed
-- from admin_actions, not from that table.
